import { Power, X } from "lucide-react";
import { PermissionRows } from "./PermissionRows";
import type { PermissionKey, PermissionSnapshot } from "../permissions/permissionTypes";
import { areAllPermissionsGranted } from "../permissions/permissionTypes";
import type { GlideSettings, GlideVoiceState } from "../settings/settingsTypes";

type CompanionPanelProps = {
  permissions: PermissionSnapshot;
  settings: GlideSettings;
  voiceState: GlideVoiceState;
  onDismiss: () => void;
  onGrantPermission: (key: PermissionKey) => void;
  onFindApp: () => void;
  onQuit: () => void;
  onStart: () => void;
};

function getStatusText(voiceState: GlideVoiceState, hasCompletedOnboarding: boolean, allPermissionsGranted: boolean): string {
  if (!hasCompletedOnboarding || !allPermissionsGranted) {
    return "Setup";
  }
  switch (voiceState) {
    case "listening":
      return "Listening";
    case "processing":
      return "Processing";
    case "responding":
      return "Responding";
    case "idle":
      return "Active";
  }
}

export function CompanionPanel({
  permissions,
  settings,
  voiceState,
  onDismiss,
  onGrantPermission,
  onFindApp,
  onQuit,
  onStart,
}: CompanionPanelProps) {
  const allPermissionsGranted = areAllPermissionsGranted(permissions);
  const showPermissionRows = !allPermissionsGranted;
  const showStart = !settings.hasCompletedOnboarding && allPermissionsGranted;

  return (
    <section className="companion-panel" aria-label="Glide companion panel">
      <header className="panel-header">
        <div className="panel-title">Glide</div>
        <span className="panel-spacer" />
        <div className="panel-status">{getStatusText(voiceState, settings.hasCompletedOnboarding, allPermissionsGranted)}</div>
        <button className="panel-close" aria-label="Close panel" type="button" onClick={onDismiss}>
          <X size={10} strokeWidth={3} />
        </button>
      </header>

      <div className="panel-divider" />

      <div className="copy-section">
        {settings.hasCompletedOnboarding && allPermissionsGranted ? "Hold Control+Option to talk." : null}
        {!settings.hasCompletedOnboarding && allPermissionsGranted ? "You're all set. Hit Start to meet Glide." : null}
        {settings.hasCompletedOnboarding && !allPermissionsGranted ? (
          <>
            <p className="copy-title">Permissions needed</p>
            <p className="copy-muted">Some permissions were revoked. Grant all four below to keep using Glide.</p>
          </>
        ) : null}
      </div>

      {showPermissionRows ? (
        <div className="settings-section">
          <div className="section-label">PERMISSIONS</div>
          <PermissionRows permissions={permissions} onGrant={onGrantPermission} onFindApp={onFindApp} />
        </div>
      ) : null}

      {showStart ? (
        <button className="start-button" type="button" onClick={onStart}>
          Start
        </button>
      ) : null}

      <div className="footer-gap" />
      <div className="panel-divider" />
      <footer className="panel-footer">
        <button className="footer-button" type="button" onClick={onQuit}>
          <Power size={11} />
          Quit Glide
        </button>
      </footer>
    </section>
  );
}
