use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct DirFileEntry {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    /// Segundos totais quando inferível pelo cabeçalho (Symphonia); ausente em alguns VBR/streams.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_sec: Option<f64>,
}
