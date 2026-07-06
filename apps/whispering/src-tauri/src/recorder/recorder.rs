use crate::recorder::wav_writer::WavWriter;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use tracing::{debug, error, info};

/// Simple result type using String for errors
pub type Result<T> = std::result::Result<T, String>;

/// Audio recording metadata - returned to frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioRecording {
    pub audio_data: Vec<f32>, // Empty for file-based recording
    pub sample_rate: u32,
    pub channels: u16,
    pub duration_seconds: f32,
    pub file_path: Option<String>, // Path to the WAV file
}

/// Minimal wrapper to handle the Stream in its own thread
/// This is necessary because CPAL streams aren't Send+Sync on macOS
struct StreamHolder {
    thread: Option<JoinHandle<()>>,
    is_recording: Arc<AtomicBool>,
    should_stop: Arc<AtomicBool>,
}

impl StreamHolder {
    fn new<F>(create_stream: F, is_recording: Arc<AtomicBool>) -> Result<Self>
    where
        F: FnOnce() -> Result<Stream> + Send + 'static,
    {
        let should_stop = Arc::new(AtomicBool::new(false));
        let should_stop_clone = should_stop.clone();

        // Create and run the stream in its own thread
        let thread = thread::spawn(move || {
            // Create the stream in this thread
            let stream = match create_stream() {
                Ok(s) => s,
                Err(e) => {
                    error!("Failed to create stream in thread: {}", e);
                    return;
                }
            };

            // Keep the stream alive until told to stop
            while !should_stop_clone.load(Ordering::Acquire) {
                thread::sleep(std::time::Duration::from_millis(100));
            }
            // Stream drops here, which stops it
            drop(stream);
        });

        Ok(Self {
            thread: Some(thread),
            is_recording,
            should_stop,
        })
    }

    fn stop(&mut self) {
        self.is_recording.store(false, Ordering::Release);
        self.should_stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for StreamHolder {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Simplified recorder state
pub struct RecorderState {
    stream_holder: Option<StreamHolder>,
    writer: Arc<Mutex<Option<WavWriter>>>,
    is_recording: Arc<AtomicBool>,
    current_device: Option<String>,
    sample_rate: u32,
    channels: u16,
    file_path: Option<PathBuf>,
}

impl RecorderState {
    pub fn new() -> Self {
        Self {
            stream_holder: None,
            writer: Arc::new(Mutex::new(None)),
            is_recording: Arc::new(AtomicBool::new(false)),
            current_device: None,
            sample_rate: 0,
            channels: 0,
            file_path: None,
        }
    }

    /// List available recording devices by name
    pub fn enumerate_devices(&self) -> Result<Vec<String>> {
        let host = cpal::default_host();
        let devices = host
            .input_devices()
            .map_err(|e| format!("Failed to get input devices: {}", e))?
            .filter_map(|device| device.name().ok())
            .collect();

        Ok(devices)
    }

    /// Initialize recording session.
    /// Reuses the existing CPAL stream if the device hasn't changed — only swaps
    /// the WavWriter. Rebuilds the stream from scratch on first call or device change.
    pub fn init_session(
        &mut self,
        device_name: String,
        output_folder: PathBuf,
        recording_id: String,
        preferred_sample_rate: Option<u32>,
    ) -> Result<()> {
        let file_path = output_folder.join(format!("{}.wav", recording_id));

        let can_reuse = self.stream_holder.is_some()
            && self.current_device.as_deref() == Some(&device_name);

        if !can_reuse {
            // Expensive path: build a new stream
            self.close_session()?;

            let host = cpal::default_host();
            let device = find_device(&host, &device_name)?;
            let config = get_optimal_config(&device, preferred_sample_rate)?;
            let sample_format = config.sample_format();
            let sample_rate = config.sample_rate().0;
            let channels = config.channels();

            let stream_config = cpal::StreamConfig {
                channels,
                sample_rate: cpal::SampleRate(sample_rate),
                buffer_size: cpal::BufferSize::Fixed(256),
            };

            self.is_recording = Arc::new(AtomicBool::new(false));
            let is_recording = self.is_recording.clone();
            let is_recording_clone = is_recording.clone();
            let writer = self.writer.clone();

            let stream_holder = StreamHolder::new(
                move || match sample_format {
                    SampleFormat::F32 => {
                        build_stream_f32(&device, &stream_config, is_recording_clone, writer)
                    }
                    SampleFormat::I16 => {
                        build_stream_i16(&device, &stream_config, is_recording_clone, writer)
                    }
                    SampleFormat::U16 => {
                        build_stream_u16(&device, &stream_config, is_recording_clone, writer)
                    }
                    _ => Err("Unsupported sample format".to_string()),
                },
                is_recording,
            )?;

            self.stream_holder = Some(stream_holder);
            self.sample_rate = sample_rate;
            self.channels = channels;
            self.current_device = Some(device_name);

            info!(
                "Recording stream built: {} Hz, {} channels",
                self.sample_rate, self.channels
            );
        }

        // Cheap path (always): swap in a fresh WavWriter for this recording
        let new_writer = WavWriter::new(file_path.clone(), self.sample_rate, self.channels)
            .map_err(|e| format!("Failed to create WAV file: {}", e))?;

        {
            let mut w = self
                .writer
                .lock()
                .map_err(|e| format!("Lock error: {}", e))?;
            *w = Some(new_writer);
        }

        self.is_recording.store(false, Ordering::Release);
        self.file_path = Some(file_path);

        info!(
            "Recording session ready: file: {:?} (stream reused: {})",
            self.file_path, can_reuse
        );

        Ok(())
    }

    /// Start recording - just set the flag
    pub fn start_recording(&mut self) -> Result<()> {
        if self.stream_holder.is_none() {
            return Err("No recording session initialized".to_string());
        }

        self.is_recording.store(true, Ordering::Release);

        info!("Recording started");
        Ok(())
    }

    /// Stop recording - finalize WAV, leave stream alive for next Fn press
    pub fn stop_recording(&mut self) -> Result<AudioRecording> {
        self.is_recording.store(false, Ordering::Release);

        let (sample_rate, channels, duration) = {
            let mut w = self
                .writer
                .lock()
                .map_err(|e| format!("Lock error: {}", e))?;
            if let Some(ref mut writer) = *w {
                writer
                    .finalize()
                    .map_err(|e| format!("Failed to finalize WAV: {}", e))?;
                let meta = writer.get_metadata();
                *w = None;
                meta
            } else {
                (self.sample_rate, self.channels, 0.0)
            }
        };

        let file_path = self
            .file_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string());

        info!("Recording stopped: {:.2}s, file: {:?}", duration, file_path);

        Ok(AudioRecording {
            audio_data: Vec::new(),
            sample_rate,
            channels,
            duration_seconds: duration,
            file_path,
        })
    }

    /// Cancel recording - clear writer and delete file, leave stream alive
    pub fn cancel_recording(&mut self) -> Result<()> {
        self.is_recording.store(false, Ordering::Release);

        {
            let mut w = self
                .writer
                .lock()
                .map_err(|e| format!("Lock error: {}", e))?;
            *w = None; // drops WavWriter (Drop finalizes headers), then file is deleted below
        }

        if let Some(file_path) = &self.file_path {
            std::fs::remove_file(file_path).ok();
            debug!("Deleted recording file: {:?}", file_path);
        }
        self.file_path = None;

        Ok(())
    }

    /// Close the recording session - kills stream. Called on device change or app quit.
    pub fn close_session(&mut self) -> Result<()> {
        self.is_recording.store(false, Ordering::Release);

        if let Some(mut holder) = self.stream_holder.take() {
            holder.stop();
        }

        {
            let mut w = self
                .writer
                .lock()
                .map_err(|e| format!("Lock error: {}", e))?;
            if let Some(ref mut writer) = *w {
                let _ = writer.finalize();
            }
            *w = None;
        }

        self.file_path = None;
        self.sample_rate = 0;
        self.channels = 0;
        self.current_device = None;

        debug!("Recording session closed");
        Ok(())
    }

    /// Get current recording ID if actively recording
    pub fn get_current_recording_id(&self) -> Option<String> {
        if self.is_recording.load(Ordering::Acquire) {
            self.file_path
                .as_ref()
                .and_then(|path| path.file_stem())
                .and_then(|stem| stem.to_str())
                .map(|s| s.to_string())
        } else {
            None
        }
    }
}

/// Find a recording device by name
fn find_device(host: &cpal::Host, device_name: &str) -> Result<Device> {
    if device_name.to_lowercase() == "default" {
        return host
            .default_input_device()
            .ok_or_else(|| "No default input device available".to_string());
    }

    let devices: Vec<_> = host.input_devices().map_err(|e| e.to_string())?.collect();

    for device in devices {
        if let Ok(name) = device.name() {
            if name == device_name {
                return Ok(device);
            }
        }
    }

    Err(format!("Device '{}' not found", device_name))
}

/// Get optimal configuration for voice recording
fn get_optimal_config(
    device: &Device,
    preferred_sample_rate: Option<u32>,
) -> Result<cpal::SupportedStreamConfig> {
    let target_sample_rate = preferred_sample_rate.unwrap_or(16000);

    let configs: Vec<_> = device
        .supported_input_configs()
        .map_err(|e| e.to_string())?
        .collect();

    if configs.is_empty() {
        return Err("No supported input configurations".to_string());
    }

    for config in &configs {
        if config.channels() == 1 {
            let min_rate = config.min_sample_rate().0;
            let max_rate = config.max_sample_rate().0;
            if min_rate <= target_sample_rate && max_rate >= target_sample_rate {
                return Ok(config.with_sample_rate(cpal::SampleRate(target_sample_rate)));
            }
        }
    }

    for config in &configs {
        let min_rate = config.min_sample_rate().0;
        let max_rate = config.max_sample_rate().0;
        if min_rate <= target_sample_rate && max_rate >= target_sample_rate {
            return Ok(config.with_sample_rate(cpal::SampleRate(target_sample_rate)));
        }
    }

    let mut best_config = None;
    let mut best_diff = u32::MAX;

    for config in &configs {
        if config.channels() == 1 {
            let min_rate = config.min_sample_rate().0;
            let max_rate = config.max_sample_rate().0;

            let closest_rate = if target_sample_rate < min_rate {
                min_rate
            } else if target_sample_rate > max_rate {
                max_rate
            } else {
                target_sample_rate
            };

            let diff = (closest_rate as i32 - target_sample_rate as i32).abs() as u32;
            if diff < best_diff {
                best_diff = diff;
                best_config = Some(config.with_sample_rate(cpal::SampleRate(closest_rate)));
            }
        }
    }

    best_config
        .or_else(|| device.default_input_config().ok())
        .ok_or_else(|| "Failed to find suitable audio configuration".to_string())
}

/// Build stream for f32 samples
fn build_stream_f32(
    device: &Device,
    config: &cpal::StreamConfig,
    is_recording: Arc<AtomicBool>,
    writer: Arc<Mutex<Option<WavWriter>>>,
) -> Result<Stream> {
    let err_fn = |err| error!("Audio stream error: {}", err);

    let stream = device
        .build_input_stream(
            config,
            move |data: &[f32], _: &_| {
                if is_recording.load(Ordering::Acquire) {
                    if let Ok(mut w) = writer.lock() {
                        if let Some(ref mut w) = *w {
                            let _ = w.write_samples_f32(data);
                        }
                    }
                }
            },
            err_fn,
            None,
        )
        .map_err(|e| format!("Failed to build stream: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start stream: {}", e))?;

    Ok(stream)
}

/// Build stream for i16 samples
fn build_stream_i16(
    device: &Device,
    config: &cpal::StreamConfig,
    is_recording: Arc<AtomicBool>,
    writer: Arc<Mutex<Option<WavWriter>>>,
) -> Result<Stream> {
    let err_fn = |err| error!("Audio stream error: {}", err);

    let stream = device
        .build_input_stream(
            config,
            move |data: &[i16], _: &_| {
                if is_recording.load(Ordering::Acquire) {
                    if let Ok(mut w) = writer.lock() {
                        if let Some(ref mut w) = *w {
                            let _ = w.write_samples_i16(data);
                        }
                    }
                }
            },
            err_fn,
            None,
        )
        .map_err(|e| format!("Failed to build stream: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start stream: {}", e))?;

    Ok(stream)
}

/// Build stream for u16 samples
fn build_stream_u16(
    device: &Device,
    config: &cpal::StreamConfig,
    is_recording: Arc<AtomicBool>,
    writer: Arc<Mutex<Option<WavWriter>>>,
) -> Result<Stream> {
    let err_fn = |err| error!("Audio stream error: {}", err);

    let stream = device
        .build_input_stream(
            config,
            move |data: &[u16], _: &_| {
                if is_recording.load(Ordering::Acquire) {
                    if let Ok(mut w) = writer.lock() {
                        if let Some(ref mut w) = *w {
                            let _ = w.write_samples_u16(data);
                        }
                    }
                }
            },
            err_fn,
            None,
        )
        .map_err(|e| format!("Failed to build stream: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start stream: {}", e))?;

    Ok(stream)
}

impl Drop for RecorderState {
    fn drop(&mut self) {
        let _ = self.close_session();
    }
}
