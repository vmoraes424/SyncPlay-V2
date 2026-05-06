use crate::models::mixer::VuLevel;

/// Aplica ganho linear a um bloco de áudio
#[inline]
pub fn apply_gain(buffer: &mut [f32], gain: f32) {
    if gain == 1.0 { return; }
    if gain == 0.0 {
        buffer.fill(0.0);
        return;
    }
    for sample in buffer.iter_mut() {
        *sample *= gain;
    }
}

/// Soma o áudio da `source` no `target` (usado para roteamento e mixagem)
#[inline]
pub fn mix_add(target: &mut [f32], source: &[f32]) {
    let len = target.len().min(source.len());
    for i in 0..len {
        target[i] += source[i];
    }
}

/// Converte amplitude para dB normalizado (0.0 a 1.0) para a UI
#[inline]
fn amp_to_db_normalized(amp: f32) -> f32 {
    if amp <= 0.001 { return 0.0; }
    let db = 20.0 * amp.log10();
    let min_db = -60.0;
    let normalized = ((db - min_db) / (-min_db)).clamp(0.0, 1.0);
    normalized * normalized
}

/// Calcula RMS e Peak de um bloco de áudio estéreo entrelaçado [L, R, L, R...]
pub fn calculate_vu(buffer: &[f32], current_vu: &mut VuLevel, decay: f32) {
    let mut sum_l = 0.0;
    let mut sum_r = 0.0;
    let mut peak_l = 0.0_f32;
    let mut peak_r = 0.0_f32;
    let mut frames = 0;

    for chunk in buffer.chunks_exact(2) {
        let (l, r) = (chunk[0], chunk[1]);
        sum_l += l * l;
        sum_r += r * r;
        peak_l = peak_l.max(l.abs());
        peak_r = peak_r.max(r.abs());
        frames += 1;
    }

    if frames > 0 {
        let rms_l = (sum_l / frames as f32).sqrt();
        let rms_r = (sum_r / frames as f32).sqrt();

        // Atualiza RMS
        current_vu.rms_left = amp_to_db_normalized(rms_l);
        current_vu.rms_right = amp_to_db_normalized(rms_r);

        // Atualiza Peak com decaimento suave
        let new_peak_l = amp_to_db_normalized(peak_l);
        let new_peak_r = amp_to_db_normalized(peak_r);
        
        current_vu.peak_left = current_vu.peak_left.max(new_peak_l) * decay;
        current_vu.peak_right = current_vu.peak_right.max(new_peak_r) * decay;
    }
}