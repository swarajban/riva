'use client';

import { useState } from 'react';

export type AutomationLevel = 'confirm-all' | 'confirm-calendar' | 'full-auto';

interface AutomationSelectorProps {
  value?: AutomationLevel;
  onChange?: (level: AutomationLevel) => void;
}

const levels: { id: AutomationLevel; label: string }[] = [
  {
    id: 'confirm-all',
    label: 'Confirm All',
  },
  {
    id: 'confirm-calendar',
    label: 'Confirm Calendar',
  },
  {
    id: 'full-auto',
    label: 'Full Auto',
  },
];

export function AutomationSelector({
  value = 'confirm-calendar',
  onChange,
}: AutomationSelectorProps) {
  const [selected, setSelected] = useState<AutomationLevel>(value);
  const [hoveredLevel, setHoveredLevel] = useState<AutomationLevel | null>(null);

  const handleSelect = (level: AutomationLevel) => {
    setSelected(level);
    onChange?.(level);
  };

  const selectedIndex = levels.findIndex((l) => l.id === selected);
  const displayLevel = hoveredLevel || selected;

  const getEmailStatus = (level: AutomationLevel) => {
    return level === 'confirm-all' ? 'approval' : 'auto';
  };

  const getCalendarStatus = (level: AutomationLevel) => {
    return level === 'full-auto' ? 'auto' : 'approval';
  };

  const getDescription = (level: AutomationLevel) => {
    switch (level) {
      case 'confirm-all':
        return 'You approve emails and calendar invites';
      case 'confirm-calendar':
        return 'Emails send automatically';
      case 'full-auto':
        return 'Everything happens automatically';
    }
  };

  return (
    <div className="automation-selector">
      <style jsx>{`
        .automation-selector {
          --color-bg: #f3f1ed;
          --color-surface: #ffffff;
          --color-surface-elevated: #faf9f7;
          --color-border: #e5e3df;
          --color-text: #1a1a1f;
          --color-text-muted: #5a5a65;
          --color-accent: #b8845c;
          --color-accent-light: rgba(184, 132, 92, 0.08);
          --color-auto: #059669;
          --color-approval: #b8845c;

          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 16px;
          padding: 24px;
          width: 100%;
          max-width: 420px;
          color: var(--color-text);
          box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 8px 40px rgba(0,0,0,0.06);
        }

        .selector-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 24px;
        }

        .selector-icon {
          width: 40px;
          height: 40px;
          background: var(--color-accent-light);
          border: 1px solid var(--color-border);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--color-accent);
        }

        .selector-title {
          font-family: var(--font-display), Georgia, serif;
          font-size: 18px;
          font-weight: 500;
          letter-spacing: -0.01em;
        }

        .track-container {
          position: relative;
          margin-bottom: 28px;
        }

        .track {
          display: flex;
          background: var(--color-bg);
          border-radius: 14px;
          padding: 6px;
          position: relative;
          gap: 4px;
          overflow: hidden;
        }

        .track-indicator {
          position: absolute;
          top: 6px;
          bottom: 6px;
          left: 6px;
          width: calc((100% - 12px - 8px) / 3);
          background: var(--color-surface);
          border-radius: 10px;
          transition: left 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
          border: 1px solid var(--color-border);
        }

        .track-indicator[data-index='0'] {
          left: 6px;
        }
        .track-indicator[data-index='1'] {
          left: calc(6px + (100% - 12px - 8px) / 3 + 4px);
        }
        .track-indicator[data-index='2'] {
          left: calc(6px + 2 * (100% - 12px - 8px) / 3 + 8px);
        }

        .track-option {
          flex: 1;
          padding: 14px 8px;
          text-align: center;
          cursor: pointer;
          position: relative;
          z-index: 1;
          border-radius: 10px;
          transition: all 0.2s ease;
        }

        .track-option:hover {
          background: rgba(255, 255, 255, 0.03);
        }

        .option-label {
          font-size: 13px;
          font-weight: 500;
          color: var(--color-text-muted);
          transition: color 0.2s ease;
          letter-spacing: 0.01em;
        }

        .track-option[data-selected='true'] .option-label {
          color: var(--color-text);
        }

        .spectrum-line {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 8px;
          margin-top: 12px;
        }

        .spectrum-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--color-text-muted);
          opacity: 0.6;
        }

        .spectrum-dots {
          display: flex;
          gap: 6px;
          transform: translateY(1px);
        }

        .spectrum-dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: var(--color-border);
        }

        .detail-card {
          background: var(--color-bg);
          border-radius: 12px;
          padding: 20px;
        }

        .detail-header {
          text-align: center;
          margin-bottom: 16px;
          padding-bottom: 14px;
          border-bottom: 1px solid var(--color-border);
        }

        .detail-level-name {
          font-family: var(--font-display), Georgia, serif;
          font-size: 16px;
          font-weight: 500;
          display: block;
          margin-bottom: 4px;
        }

        .detail-description {
          font-size: 13px;
          color: var(--color-text-muted);
          display: block;
        }

        .status-rows {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .status-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .status-item {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .status-icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--color-bg);
          color: var(--color-text-muted);
        }

        .status-label {
          font-size: 13px;
          color: var(--color-text-muted);
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.02em;
        }

        .status-badge[data-status='auto'] {
          background: rgba(5, 150, 105, 0.1);
          color: var(--color-auto);
        }

        .status-badge[data-status='approval'] {
          background: var(--color-accent-light);
          color: var(--color-approval);
        }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .status-badge[data-status='auto'] .status-dot {
          background: var(--color-auto);
        }

        .status-badge[data-status='approval'] .status-dot {
          background: var(--color-approval);
        }
      `}</style>

      <div className="selector-header">
        <div className="selector-icon">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <span className="selector-title">Automation Level</span>
      </div>

      <div className="track-container">
        <div className="track">
          <div className="track-indicator" data-index={selectedIndex} />
          {levels.map((level) => (
            <div
              key={level.id}
              className="track-option"
              data-selected={selected === level.id}
              onClick={() => handleSelect(level.id)}
              onMouseEnter={() => setHoveredLevel(level.id)}
              onMouseLeave={() => setHoveredLevel(null)}
            >
              <span className="option-label">{level.label}</span>
            </div>
          ))}
        </div>

        <div className="spectrum-line">
          <span className="spectrum-label">Manual</span>
          <div className="spectrum-dots">
            <div className="spectrum-dot" />
            <div className="spectrum-dot" />
            <div className="spectrum-dot" />
            <div className="spectrum-dot" />
            <div className="spectrum-dot" />
          </div>
          <span className="spectrum-label">Autonomous</span>
        </div>
      </div>

      <div className="detail-card">
        <div className="detail-header">
          <span className="detail-level-name">
            {levels.find((l) => l.id === displayLevel)?.label}
          </span>
          <span className="detail-description">
            {getDescription(displayLevel)}
          </span>
        </div>

        <div className="status-rows">
          <div className="status-row">
            <div className="status-item">
              <div className="status-icon">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </div>
              <span className="status-label">Emails</span>
            </div>
            <div
              className="status-badge"
              data-status={getEmailStatus(displayLevel)}
            >
              <div className="status-dot" />
              {getEmailStatus(displayLevel) === 'auto' ? 'Automatic' : 'Approval'}
            </div>
          </div>

          <div className="status-row">
            <div className="status-item">
              <div className="status-icon">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <span className="status-label">Calendar Invites</span>
            </div>
            <div
              className="status-badge"
              data-status={getCalendarStatus(displayLevel)}
            >
              <div className="status-dot" />
              {getCalendarStatus(displayLevel) === 'auto' ? 'Automatic' : 'Approval'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
