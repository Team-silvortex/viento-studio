#![forbid(unsafe_code)]

use crate::CoreError;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

const LIMIT: f64 = 100_000.0;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionChange {
    pub object_id: String,
    pub position: [f64; 2],
}

struct SelectedActor<'a> {
    object_id: &'a str,
    position: [f64; 2],
    size: [f64; 2],
}

fn finite_pair(value: &Value) -> Result<[f64; 2], CoreError> {
    let values = value
        .as_array()
        .filter(|items| items.len() == 2)
        .ok_or_else(CoreError::position)?;
    let number = |value: &Value| {
        value
            .as_f64()
            .filter(|number| number.is_finite())
            .ok_or_else(CoreError::position)
    };
    Ok([number(&values[0])?, number(&values[1])?])
}

fn position(value: &Value) -> Result<[f64; 2], CoreError> {
    let pair = finite_pair(value)?;
    if pair.iter().any(|number| number.abs() > LIMIT) {
        return Err(CoreError::position());
    }
    Ok(pair)
}

fn actor_index(actors: &Value) -> Result<HashMap<&str, &Value>, CoreError> {
    let actors = actors.as_array().ok_or_else(CoreError::position)?;
    let mut by_id = HashMap::with_capacity(actors.len());
    for actor in actors {
        let object = actor.as_object().ok_or_else(CoreError::position)?;
        let id = object
            .get("objectId")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or_else(CoreError::position)?;
        if by_id.insert(id, actor).is_some() {
            return Err(CoreError::position());
        }
    }
    Ok(by_id)
}

fn selection<'a>(actors: &'a Value, ids: &Value) -> Result<Vec<SelectedActor<'a>>, CoreError> {
    let by_id = actor_index(actors)?;
    let ids = ids.as_array().ok_or_else(CoreError::position)?;
    let mut seen = HashSet::with_capacity(ids.len());
    let mut selected = Vec::with_capacity(ids.len());
    for id in ids {
        let id = id.as_str().ok_or_else(CoreError::position)?;
        let (object_id, actor) = by_id.get_key_value(id).ok_or_else(CoreError::position)?;
        if !seen.insert(id) {
            return Err(CoreError::position());
        }
        let size = finite_pair(&actor["size"])?;
        if size.iter().any(|value| *value <= 0.0) {
            return Err(CoreError::position());
        }
        selected.push(SelectedActor {
            object_id,
            position: position(&actor["position"])?,
            size,
        });
    }
    Ok(selected)
}

// Rust's round() rounds negative ties away from zero. JavaScript Math.round()
// rounds ties toward positive infinity, and preserves negative zero. Avoid
// adding 0.5, which would incorrectly round the float immediately below 0.5.
fn round_like_js(value: f64) -> f64 {
    let floor = value.floor();
    let rounded = if value - floor < 0.5 {
        floor
    } else {
        floor + 1.0
    };
    if rounded == 0.0 {
        0.0_f64.copysign(value)
    } else {
        rounded
    }
}

fn snap_coordinate(value: f64, grid: f64) -> f64 {
    let remainder = value % grid;
    value - remainder
        + if remainder > 0.0 && remainder >= grid / 2.0 {
            grid
        } else if remainder < -grid / 2.0 {
            -grid
        } else {
            0.0
        }
}

pub fn move_selection(
    actors: &Value,
    ids: &Value,
    delta: &Value,
    snap: Option<&Value>,
) -> Result<Vec<PositionChange>, CoreError> {
    let delta = finite_pair(delta)?;
    let snap = match snap {
        None => 0.0,
        Some(value) => value
            .as_f64()
            .filter(|value| value.is_finite() && *value >= 0.0 && *value <= LIMIT)
            .ok_or_else(CoreError::position)?,
    };
    let selected = selection(actors, ids)?;
    let Some(anchor) = selected.first() else {
        return Ok(Vec::new());
    };
    let mut shared = [0.0; 2];
    for axis in 0..2 {
        let desired = if snap != 0.0 {
            snap_coordinate(anchor.position[axis] + delta[axis], snap) - anchor.position[axis]
        } else {
            round_like_js(delta[axis])
        };
        let minimum = selected
            .iter()
            .map(|actor| actor.position[axis])
            .fold(f64::INFINITY, f64::min);
        let maximum = selected
            .iter()
            .map(|actor| actor.position[axis])
            .fold(f64::NEG_INFINITY, f64::max);
        let low = -LIMIT - minimum;
        let high = LIMIT - maximum;
        let mut shifted = low.max(high.min(desired));
        if minimum + shifted < -LIMIT || maximum + shifted > LIMIT {
            shifted = shifted.signum()
                * (shifted.abs() - f64::EPSILON * shifted.abs().max(1.0) * 2.0).max(0.0);
        }
        shared[axis] = shifted;
    }
    Ok(selected
        .iter()
        .map(|actor| PositionChange {
            object_id: actor.object_id.into(),
            position: [actor.position[0] + shared[0], actor.position[1] + shared[1]],
        })
        .collect())
}

pub fn align_selection(
    actors: &Value,
    ids: &Value,
    alignment: &Value,
) -> Result<Vec<PositionChange>, CoreError> {
    let mode = alignment
        .as_str()
        .filter(|mode| ["left", "center", "right", "top", "middle", "bottom"].contains(mode))
        .ok_or(CoreError {
            error_code: "scene_layout_alignment_invalid",
            message: "Unsupported scene selection alignment.",
        })?;
    let selected = selection(actors, ids)?;
    if selected.len() < 2 {
        return Ok(selected
            .iter()
            .map(|actor| PositionChange {
                object_id: actor.object_id.into(),
                position: actor.position,
            })
            .collect());
    }
    let axis = usize::from(!["left", "center", "right"].contains(&mode));
    let start = selected
        .iter()
        .map(|actor| actor.position[axis] - actor.size[axis] / 2.0)
        .fold(f64::INFINITY, f64::min);
    let end = selected
        .iter()
        .map(|actor| actor.position[axis] + actor.size[axis] / 2.0)
        .fold(f64::NEG_INFINITY, f64::max);
    selected
        .iter()
        .map(|actor| {
            let mut next = actor.position;
            next[axis] = if ["left", "top"].contains(&mode) {
                start + actor.size[axis] / 2.0
            } else if ["right", "bottom"].contains(&mode) {
                end - actor.size[axis] / 2.0
            } else {
                start / 2.0 + end / 2.0
            };
            if next
                .iter()
                .any(|value| !value.is_finite() || value.abs() > LIMIT)
            {
                return Err(CoreError::position());
            }
            Ok(PositionChange {
                object_id: actor.object_id.into(),
                position: next,
            })
        })
        .collect()
}

/// Validate the whole batch before returning any edits. No-op edits remain in
/// the response; the draft decides whether to add history or preserve redo.
pub fn validate_batch(actors: &Value, changes: &Value) -> Result<Vec<PositionChange>, CoreError> {
    let by_id = actor_index(actors)?;
    for actor in by_id.values() {
        position(&actor["position"])?;
    }
    let changes = changes.as_array().ok_or_else(CoreError::position)?;
    let mut seen = HashSet::with_capacity(changes.len());
    changes
        .iter()
        .map(|change| {
            let object = change
                .as_object()
                .filter(|object| object.len() == 2)
                .ok_or_else(CoreError::position)?;
            let id = object
                .get("objectId")
                .and_then(Value::as_str)
                .ok_or_else(CoreError::position)?;
            if !by_id.contains_key(id) || !seen.insert(id) {
                return Err(CoreError::position());
            }
            Ok(PositionChange {
                object_id: id.into(),
                position: position(&change["position"])?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::round_like_js;

    #[test]
    fn javascript_rounding_handles_negative_ties_and_neighbors() {
        assert_eq!(round_like_js(-1.5), -1.0);
        assert!(round_like_js(-0.5).is_sign_negative());
        assert_eq!(round_like_js(-0.5), 0.0);
        assert_eq!(round_like_js(0.49999999999999994), 0.0);
        assert_eq!(round_like_js(-0.5000000000000001), -1.0);
        assert_eq!(round_like_js(0.5), 1.0);
        assert_eq!(round_like_js(f64::MAX), f64::MAX);
        assert_eq!(round_like_js(-f64::MAX), -f64::MAX);
    }
}
