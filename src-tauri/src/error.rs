use crate::models::audio::AudioCommand;
use serde::Serialize;
use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Erro de I/O: {0}")]
    Io(String),
    #[error("Erro de JSON: {0}")]
    Json(String),
    #[error("Erro no comando de audio: {0}")]
    AudioCommand(String),
    #[error("Estado da aplicacao indisponivel: {0}")]
    State(String),
    #[error("Erro ao decodificar audio: {0}")]
    AudioDecode(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error.to_string())
    }
}

impl From<std::sync::mpsc::SendError<AudioCommand>> for AppError {
    fn from(error: std::sync::mpsc::SendError<AudioCommand>) -> Self {
        Self::AudioCommand(error.to_string())
    }
}
