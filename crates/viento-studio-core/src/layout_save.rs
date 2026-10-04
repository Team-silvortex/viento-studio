//! Save decisions without HTTP, author source text, or persistence side effects.
#![forbid(unsafe_code)]

use crate::CoreError;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LayoutSavePhase {
    Editing,
    Checking,
    Reviewed,
    Applying,
    Uncertain,
    Verifying,
    Refreshing,
    Saved,
    Conflict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayoutSaveAction {
    Preview,
    Apply,
    Verify,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayoutSaveOutcome {
    Accepted,
    Different,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSaveState {
    pub phase: LayoutSavePhase,
    pub request_id: Option<String>,
    pub busy: bool,
    pub editable: bool,
    pub reviewed: bool,
    pub saved: bool,
    pub conflict: bool,
    pub uncertain: bool,
}

/// A per-draft workflow. Request identifiers are monotonic and never recycled,
/// including after errors, invalidation, or history reset. A host must validate
/// receipts and source equality before reporting Accepted or Different.
#[derive(Debug)]
pub struct LayoutSaveWorkflow {
    phase: LayoutSavePhase,
    request_id: Option<u64>,
    next_request_id: Option<u64>,
}

impl Default for LayoutSaveWorkflow {
    fn default() -> Self {
        Self {
            phase: LayoutSavePhase::Editing,
            request_id: None,
            next_request_id: Some(1),
        }
    }
}

impl LayoutSaveWorkflow {
    pub fn state(&self) -> LayoutSaveState {
        use LayoutSavePhase::*;
        LayoutSaveState {
            phase: self.phase,
            request_id: self.request_id.map(|id| id.to_string()),
            busy: matches!(self.phase, Checking | Applying | Verifying | Refreshing),
            editable: self.editable(),
            reviewed: self.phase == Reviewed,
            saved: matches!(self.phase, Refreshing | Saved),
            conflict: self.phase == Conflict,
            uncertain: matches!(self.phase, Uncertain | Verifying),
        }
    }

    pub fn editable(&self) -> bool {
        matches!(
            self.phase,
            LayoutSavePhase::Editing | LayoutSavePhase::Reviewed
        )
    }

    pub fn invalidate(&mut self) -> Result<(), CoreError> {
        self.ensure_editable()?;
        self.phase = LayoutSavePhase::Editing;
        Ok(())
    }

    pub(crate) fn ensure_editable(&self) -> Result<(), CoreError> {
        if !self.editable() {
            return Err(CoreError::save_invalid());
        }
        Ok(())
    }

    pub fn begin(
        &mut self,
        action: LayoutSaveAction,
        dirty: bool,
        editable: bool,
        input_pending: bool,
    ) -> Result<(), CoreError> {
        use LayoutSavePhase::*;
        let ready = dirty && editable && !input_pending;
        let phase = match action {
            LayoutSaveAction::Preview if self.editable() && ready => Checking,
            LayoutSaveAction::Apply if self.phase == Reviewed && ready => Applying,
            LayoutSaveAction::Verify if self.phase == Uncertain => Verifying,
            _ => return Err(CoreError::save_invalid()),
        };
        let id = self.next_request_id.ok_or_else(CoreError::save_invalid)?;
        self.phase = phase;
        self.request_id = Some(id);
        self.next_request_id = id.checked_add(1);
        Ok(())
    }

    fn ensure_request(&self, request_id: &str) -> Result<(), CoreError> {
        let expected = self.request_id.ok_or_else(CoreError::save_invalid)?;
        if expected.to_string() != request_id {
            return Err(CoreError::save_invalid());
        }
        Ok(())
    }

    pub fn resolve(
        &mut self,
        request_id: &str,
        outcome: LayoutSaveOutcome,
        error_code: Option<&str>,
    ) -> Result<(), CoreError> {
        self.ensure_request(request_id)?;
        if error_code.is_some_and(|code| code.len() > 128) {
            return Err(CoreError::save_invalid());
        }
        use LayoutSavePhase::*;
        if !matches!(self.phase, Checking | Applying | Verifying) {
            return Err(CoreError::save_invalid());
        }
        let next = match outcome {
            LayoutSaveOutcome::Accepted => {
                if self.phase == Checking {
                    Reviewed
                } else {
                    Refreshing
                }
            }
            LayoutSaveOutcome::Different if self.phase == Verifying => Conflict,
            LayoutSaveOutcome::Different => return Err(CoreError::save_invalid()),
            LayoutSaveOutcome::Error => {
                if matches!(
                    error_code,
                    Some(
                        "world_revision_conflict"
                            | "world_read_conflict"
                            | "world_object_not_found"
                    )
                ) {
                    Conflict
                } else if self.phase == Checking
                    || self.phase == Applying
                        && matches!(
                            error_code,
                            Some("world_scene_invalid" | "world_command_invalid")
                        )
                {
                    Editing
                } else {
                    Uncertain
                }
            }
        };
        self.phase = next;
        if next != Refreshing {
            self.request_id = None;
        }
        Ok(())
    }

    /// Refresh is presentation follow-up after an accepted save, not another
    /// persistence decision. Either successful or failed refresh finishes Saved.
    pub fn refreshed(&mut self, request_id: &str) -> Result<(), CoreError> {
        self.ensure_request(request_id)?;
        if self.phase != LayoutSavePhase::Refreshing {
            return Err(CoreError::save_invalid());
        }
        self.phase = LayoutSavePhase::Saved;
        self.request_id = None;
        Ok(())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSaveResponse {
    pub draft_id: String,
    pub state: LayoutSaveState,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exhausted_request_identifiers_do_not_reuse_tokens_or_change_state() {
        let mut workflow = LayoutSaveWorkflow {
            next_request_id: Some(u64::MAX),
            ..LayoutSaveWorkflow::default()
        };
        workflow
            .begin(LayoutSaveAction::Preview, true, true, false)
            .unwrap();
        assert_eq!(workflow.state().request_id, Some(u64::MAX.to_string()));
        workflow
            .resolve(&u64::MAX.to_string(), LayoutSaveOutcome::Error, None)
            .unwrap();
        let before = workflow.state();
        assert_eq!(
            workflow
                .begin(LayoutSaveAction::Preview, true, true, false)
                .unwrap_err()
                .error_code,
            "scene_layout_save_invalid"
        );
        assert_eq!(workflow.state(), before);
    }
}
