import { Eye, Hand, Mic, MonitorDot } from "lucide-react";
import type { ComponentType } from "react";
import type { PermissionKey, PermissionSnapshot } from "../permissions/permissionTypes";
import { isPermissionGranted } from "../permissions/permissionTypes";

type PermissionRowConfig = {
  key: PermissionKey;
  label: string;
  note?: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  secondaryAction?: boolean;
};

const rows: PermissionRowConfig[] = [
  { key: "microphone", label: "Microphone", icon: Mic },
  { key: "accessibility", label: "Accessibility", icon: Hand, secondaryAction: true },
  {
    key: "screenRecording",
    label: "Screen Recording",
    icon: MonitorDot,
    note: "Quit and reopen after granting"
  },
  { key: "screenContent", label: "Screen Content", icon: Eye }
];

type PermissionRowsProps = {
  permissions: PermissionSnapshot;
  onGrant: (key: PermissionKey) => void;
  onFindApp: () => void;
};

export function PermissionRows({ permissions, onGrant, onFindApp }: PermissionRowsProps) {
  return (
    <>
      {rows
        .filter((row) => row.key !== "screenContent" || isPermissionGranted(permissions.screenRecording))
        .map((row) => {
          const granted = isPermissionGranted(permissions[row.key]);
          const Icon = row.icon;
          return (
            <div className="permission-row" key={row.key}>
              <div className="permission-copy">
                <span className="permission-icon" data-granted={granted}>
                  <Icon size={12} strokeWidth={2.2} />
                </span>
                <span>
                  <div className="permission-label">{row.label}</div>
                  {row.note ? <div className="permission-note">{granted ? "Only takes a screenshot when you use the hotkey" : row.note}</div> : null}
                </span>
              </div>
              {granted ? (
                <span className="granted">
                  <span className="granted-dot" />
                  Granted
                </span>
              ) : (
                <>
                  <button className="grant-button" type="button" onClick={() => onGrant(row.key)}>
                    Grant
                  </button>
                  {row.secondaryAction ? (
                    <button className="secondary-pill" type="button" onClick={onFindApp}>
                      Find App
                    </button>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
    </>
  );
}
