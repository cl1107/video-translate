use crate::domain::model::Segment;

#[derive(Debug, Clone, PartialEq)]
pub struct Cue {
    pub index: usize,
    pub start: f64,
    pub end: f64,
    pub text: String,
}

pub fn format_srt_time(seconds: f64) -> String {
    let ms_total = (seconds.max(0.0) * 1000.0).round() as u64;
    let hours = ms_total / 3_600_000;
    let minutes = (ms_total % 3_600_000) / 60_000;
    let secs = (ms_total % 60_000) / 1000;
    let ms = ms_total % 1000;
    format!("{hours:02}:{minutes:02}:{secs:02},{ms:03}")
}

pub fn format_ass_time(seconds: f64) -> String {
    let cs_total = (seconds.max(0.0) * 100.0).round() as u64;
    let hours = cs_total / 360_000;
    let minutes = (cs_total % 360_000) / 6_000;
    let secs = (cs_total % 6_000) / 100;
    let cs = cs_total % 100;
    format!("{hours}:{minutes:02}:{secs:02}.{cs:02}")
}

pub fn parse_time(value: &str) -> Option<f64> {
    let normalized = value.trim().replace(',', ".");
    let parts: Vec<&str> = normalized.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let hours: f64 = parts[0].parse().ok()?;
    let minutes: f64 = parts[1].parse().ok()?;
    let seconds: f64 = parts[2].parse().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

fn normalize_timestamp(raw: &str) -> String {
    let normalized = raw.trim().replace('.', ",");
    let Some(caps) = regex_time(&normalized) else {
        return normalized;
    };
    format!(
        "{:02}:{}:{},{}",
        caps.0.parse::<u32>().unwrap_or(0),
        caps.1,
        caps.2,
        format!("{:0<3}", caps.3).chars().take(3).collect::<String>()
    )
}

fn regex_time(value: &str) -> Option<(String, String, String, String)> {
    let bytes = value.as_bytes();
    let mut i = 0;
    let take_digits = |i: &mut usize, min: usize, max: usize| -> Option<String> {
        let start = *i;
        while *i < bytes.len() && bytes[*i].is_ascii_digit() {
            *i += 1;
        }
        let count = *i - start;
        if count < min || count > max {
            None
        } else {
            Some(value[start..*i].to_string())
        }
    };
    let hh = take_digits(&mut i, 1, 2)?;
    if bytes.get(i) != Some(&b':') {
        return None;
    }
    i += 1;
    let mm = take_digits(&mut i, 2, 2)?;
    if bytes.get(i) != Some(&b':') {
        return None;
    }
    i += 1;
    let ss = take_digits(&mut i, 2, 2)?;
    if bytes.get(i) != Some(&b',') {
        return None;
    }
    i += 1;
    let ms = take_digits(&mut i, 1, 3)?;
    if i != bytes.len() {
        return None;
    }
    Some((hh, mm, ss, ms))
}

fn strip_tags(text: &str) -> String {
    let mut out = String::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '<' => {
                while let Some(next) = chars.next() {
                    if next == '>' {
                        break;
                    }
                }
            }
            '{' => {
                while let Some(next) = chars.next() {
                    if next == '}' {
                        break;
                    }
                }
            }
            _ => out.push(ch),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn parse_srt(content: &str) -> Vec<Cue> {
    let text = content
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .trim()
        .to_string();
    if text.is_empty() {
        return Vec::new();
    }
    let mut entries = Vec::new();
    for block in text.split("\n\n") {
        let lines: Vec<&str> = block
            .lines()
            .map(|line| line.trim_end())
            .filter(|line| !line.is_empty())
            .collect();
        if lines.len() < 2 {
            continue;
        }
        let mut time_idx = 0;
        if lines[0].trim().chars().all(|c| c.is_ascii_digit()) && lines.len() >= 3 {
            time_idx = 1;
        }
        let Some((start_raw, end_raw)) = split_arrow(lines[time_idx]) else {
            continue;
        };
        let start_label = normalize_timestamp(&start_raw);
        let end_label = normalize_timestamp(&end_raw);
        let Some(start) = parse_time(&start_label) else {
            continue;
        };
        let Some(end) = parse_time(&end_label) else {
            continue;
        };
        if !(start < end) {
            continue;
        }
        let body = lines[time_idx + 1..].join("\n");
        let cleaned = {
            let mut out = String::new();
            let mut chars = body.chars().peekable();
            while let Some(ch) = chars.next() {
                match ch {
                    '<' => {
                        while let Some(next) = chars.next() {
                            if next == '>' {
                                break;
                            }
                        }
                    }
                    '{' => {
                        while let Some(next) = chars.next() {
                            if next == '}' {
                                break;
                            }
                        }
                    }
                    _ => out.push(ch),
                }
            }
            out.trim().to_string()
        };
        if cleaned.is_empty() {
            continue;
        }
        entries.push(Cue {
            index: entries.len() + 1,
            start,
            end,
            text: cleaned,
        });
    }
    entries
}

fn split_arrow(line: &str) -> Option<(String, String)> {
    let idx = line.find("-->")?;
    let start = line[..idx].trim().to_string();
    let end = line[idx + 3..]
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_string();
    if start.is_empty() || end.is_empty() {
        None
    } else {
        Some((start, end))
    }
}

pub fn parse_vtt(content: &str) -> Vec<Cue> {
    let text = content.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let body = text
        .trim_start()
        .strip_prefix("WEBVTT")
        .unwrap_or(&text)
        .trim_start_matches(|c| c != '\n')
        .trim_start();
    let mut reconstructed = String::new();
    for block in body.split("\n\n") {
        let trimmed = block.trim_start();
        if trimmed.starts_with("NOTE")
            || trimmed.starts_with("STYLE")
            || trimmed.starts_with("REGION")
        {
            continue;
        }
        if let Some(line) = block.lines().find(|line| line.contains("-->")) {
            let rest: Vec<&str> = block
                .lines()
                .skip_while(|line| !line.contains("-->"))
                .collect();
            if rest.is_empty() {
                continue;
            }
            reconstructed.push_str(&format!("1\n{}\n\n", rest.join("\n")));
            let _ = line;
        }
    }
    parse_srt(&reconstructed)
}

pub fn parse_subtitle(content: &str, hint: Option<&str>) -> Vec<Cue> {
    let hint = hint.unwrap_or("").to_ascii_lowercase();
    if hint == "vtt" || content.trim_start().starts_with("WEBVTT") {
        parse_vtt(content)
    } else {
        parse_srt(content)
    }
}

pub fn generate_srt(cues: &[Cue]) -> String {
    cues.iter()
        .enumerate()
        .map(|(index, cue)| {
            format!(
                "{}\n{} --> {}\n{}\n",
                index + 1,
                format_srt_time(cue.start),
                format_srt_time(cue.end),
                cue.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn generate_vtt(cues: &[Cue]) -> String {
    let body = cues
        .iter()
        .map(|cue| {
            format!(
                "{} --> {}\n{}\n",
                format_srt_time(cue.start).replace(',', "."),
                format_srt_time(cue.end).replace(',', "."),
                cue.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!("WEBVTT\n\n{body}")
}

pub fn cues_from_segments(segments: &[Segment], which: Track) -> Vec<Cue> {
    segments
        .iter()
        .enumerate()
        .map(|(index, segment)| Cue {
            index: index + 1,
            start: segment.start,
            end: segment.end,
            text: match which {
                Track::Original => segment.asr_text().to_string(),
                Track::Translated => segment
                    .translated_text
                    .as_deref()
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .unwrap_or_else(|| segment.display_source())
                    .to_string(),
                Track::Bilingual => {
                    let original = segment.asr_text();
                    let translated = segment
                        .translated_text
                        .as_deref()
                        .map(str::trim)
                        .filter(|text| !text.is_empty());
                    match translated {
                        Some(translated) if translated != original => {
                            format!("{original}\n{translated}")
                        }
                        _ => original.to_string(),
                    }
                }
            },
        })
        .filter(|cue| !cue.text.is_empty())
        .collect()
}

#[derive(Clone, Copy)]
pub enum Track {
    Original,
    Translated,
    Bilingual,
}

pub fn generate_ass(cues: &[Cue], original_color: &str, translated_color: &str) -> String {
    let orig = ass_color(original_color, "&H00FFFFFF");
    let trans = ass_color(translated_color, "&H0000FFFF");
    let mut out = String::from(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n",
    );
    out.push_str(&format!(
        "Style: Original,PingFang SC,48,{orig},&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0,2,40,40,80,1\n"
    ));
    out.push_str(&format!(
        "Style: Translated,PingFang SC,48,{trans},&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0,2,40,40,24,1\n"
    ));
    out.push_str(
        "\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
    );
    for cue in cues {
        let (original, translated) = split_bilingual(&cue.text);
        if !original.is_empty() {
            out.push_str(&format!(
                "Dialogue: 0,{},{},Original,,0,0,0,,{}\n",
                format_ass_time(cue.start),
                format_ass_time(cue.end),
                escape_ass(&original)
            ));
        }
        if !translated.is_empty() {
            out.push_str(&format!(
                "Dialogue: 1,{},{},Translated,,0,0,0,,{}\n",
                format_ass_time(cue.start),
                format_ass_time(cue.end),
                escape_ass(&translated)
            ));
        }
    }
    out
}

fn split_bilingual(text: &str) -> (String, String) {
    if let Some((a, b)) = text.split_once('\n') {
        (a.to_string(), b.to_string())
    } else {
        (text.to_string(), String::new())
    }
}

fn escape_ass(text: &str) -> String {
    text.replace('\\', "\\\\").replace('\n', "\\N")
}

fn ass_color(hex: &str, fallback: &str) -> String {
    let value = hex.trim().trim_start_matches('#');
    if value.len() != 6 {
        return fallback.to_string();
    }
    let r = &value[0..2];
    let g = &value[2..4];
    let b = &value[4..6];
    format!("&H00{b}{g}{r}")
}

pub fn segments_from_cues(task_id: &str, cues: &[Cue]) -> Vec<Segment> {
    cues.iter()
        .enumerate()
        .map(|(index, cue)| Segment {
            id: format!("{task_id}:seg-{}", index + 1),
            start: cue.start,
            end: cue.end,
            original_text: cue.text.clone(),
            polished_text: None,
            translated_text: None,
            translation_status: None,
            confidence: 1.0,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_standard_srt() {
        let srt = "1\n00:00:01,000 --> 00:00:03,500\nHello world\n\n2\n00:00:04,000 --> 00:00:06,000\nLine one\nLine two\n";
        let entries = parse_srt(srt);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].text, "Hello world");
        assert!((entries[0].end - 3.5).abs() < 0.001);
        assert_eq!(entries[1].text, "Line one\nLine two");
    }

    #[test]
    fn parse_vtt_ignores_header() {
        let vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n";
        let entries = parse_vtt(vtt);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].text, "Hi");
    }

    #[test]
    fn roundtrip_time() {
        assert_eq!(format_srt_time(3661.5), "01:01:01,500");
        assert!((parse_time("01:01:01,500").unwrap() - 3661.5).abs() < 0.001);
    }

    #[test]
    fn strips_simple_tags() {
        let srt = "1\n00:00:00,000 --> 00:00:01,000\n<i>Hello</i> {\\an8}world\n";
        let entries = parse_srt(srt);
        assert_eq!(entries[0].text, "Hello world");
        let _ = strip_tags;
    }
}
