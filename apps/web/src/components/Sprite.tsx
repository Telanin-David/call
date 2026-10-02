export default function Sprite() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" style={{ display: 'none' }}>
      <symbol id="i-call" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 2h3l1.5 3.5-2 1.5c.9 1.8 2.2 3.1 4 4l1.5-2L14.5 10.5V13.5A1.5 1.5 0 0 1 13 15C7.5 15 3 10.5 3 5a1.5 1.5 0 0 1 0-3z"/>
      </symbol>
      <symbol id="i-hangup" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 10.5C13.5 8 10.5 6.5 9 6.5S4.5 8 2 10.5l1.5 1.5 2-1 .5 2h6l.5-2 2 1 1.5-1.5z" fill="currentColor" stroke="none"/>
      </symbol>
      <symbol id="i-mic" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="1" width="6" height="10" rx="3"/>
        <path d="M3 9a6 6 0 0 0 12 0M9 15v2M6 17h6"/>
      </symbol>
      <symbol id="i-micoff" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="1" width="6" height="10" rx="3"/>
        <path d="M3 9a6 6 0 0 0 12 0M9 15v2M6 17h6M2 2l14 14"/>
      </symbol>
      <symbol id="i-phone" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="1" width="10" height="16" rx="2"/>
        <circle cx="9" cy="14" r="1" fill="currentColor" stroke="none"/>
      </symbol>
      <symbol id="i-laptop" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="14" height="10" rx="1.5"/>
        <path d="M1 15h16"/>
      </symbol>
      <symbol id="i-pause" viewBox="0 0 18 18" fill="currentColor">
        <rect x="4" y="3" width="3" height="12" rx="1.5"/>
        <rect x="11" y="3" width="3" height="12" rx="1.5"/>
      </symbol>
      <symbol id="i-skip" viewBox="0 0 18 18" fill="currentColor">
        <path d="M4 3l8 6-8 6V3z"/>
        <rect x="13" y="3" width="2" height="12" rx="1"/>
      </symbol>
      <symbol id="i-up" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 14V4M4 9l5-5 5 5"/>
      </symbol>
      <symbol id="i-down" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 4v10M4 9l5 5 5-5"/>
      </symbol>
      <symbol id="i-left" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4L5 9l6 5"/>
      </symbol>
      <symbol id="i-right" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 4l6 5-6 5"/>
      </symbol>
      <symbol id="i-x" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M4 4l10 10M14 4L4 14"/>
      </symbol>
      <symbol id="i-check" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l4 4 8-8"/>
      </symbol>
      <symbol id="i-callback" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 5h3l1.5 3.5-2 1.5c.9 1.8 2.2 3.1 4 4l1.5-2 3.5 1.5V16a1 1 0 0 1-1 1C7 17 1 11 1 5a1 1 0 0 1 1-1z"/>
        <path d="M14 1v5M14 1l-3 3M14 1l3 3"/>
      </symbol>
      <symbol id="i-missed" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 5h3l1.5 3.5-2 1.5c.9 1.8 2.2 3.1 4 4l1.5-2 3.5 1.5V16a1 1 0 0 1-1 1C7 17 1 11 1 5a1 1 0 0 1 1-1z"/>
        <path d="M17 1L11 7M11 1l6 6"/>
      </symbol>
      <symbol id="i-wrong" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 5h3l1.5 3.5-2 1.5c.9 1.8 2.2 3.1 4 4l1.5-2 3.5 1.5V16a1 1 0 0 1-1 1C7 17 1 11 1 5a1 1 0 0 1 1-1z"/>
        <path d="M12 2l5 5M17 2l-5 5"/>
      </symbol>
      <symbol id="i-ban" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="9" r="7"/>
        <path d="M4.5 4.5l9 9"/>
      </symbol>
      <symbol id="i-panel" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="14" height="12" rx="2"/>
        <path d="M7 3v12"/>
      </symbol>
      <symbol id="i-vol" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6.5H6L10 3v12l-4-3.5H3V6.5z"/>
        <path d="M13 5a5 5 0 0 1 0 8M15 3a8 8 0 0 1 0 12"/>
      </symbol>
      <symbol id="i-building" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="10" height="15" rx="1"/>
        <path d="M12 6h3a1 1 0 0 1 1 1v8h-4M5 5h4M5 8h4M5 11h4M5 14h4"/>
      </symbol>
      <symbol id="i-mail" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="14" height="10" rx="2"/>
        <path d="M2 6l7 5 7-5"/>
      </symbol>
      <symbol id="i-pin" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l-6 6 2 2-1.5 1.5-3.5 4 4-3.5L8.5 10.5l2 2 6-6-4.5-4.5z"/>
        <path d="M9 9l4.5-4.5"/>
      </symbol>
      <symbol id="i-globe" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="9" r="7"/>
        <path d="M9 2C9 2 6 5 6 9s3 7 3 7M9 2c0 0 3 3 3 7s-3 7-3 7M2 9h14"/>
      </symbol>
      <symbol id="i-list" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M6 4.5h8M6 9h8M6 13.5h8M3 4.5h.01M3 9h.01M3 13.5h.01"/>
      </symbol>
      <symbol id="i-history" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 9a7 7 0 1 1 .5 2.5"/>
        <path d="M2 4v5h5"/>
        <path d="M9 6v3l2 2"/>
      </symbol>
      <symbol id="i-note" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 2H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-5-5z"/>
        <path d="M10 2v5h5M6 10h6M6 13h4"/>
      </symbol>
      <symbol id="i-qr" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="6" height="6" rx="1"/>
        <rect x="10" y="2" width="6" height="6" rx="1"/>
        <rect x="2" y="10" width="6" height="6" rx="1"/>
        <path d="M10 10h2v2h-2zM14 10h2M10 14h2M14 14v2M10 12v2"/>
      </symbol>
      <symbol id="i-more" viewBox="0 0 18 18" fill="currentColor">
        <circle cx="4" cy="9" r="1.5"/>
        <circle cx="9" cy="9" r="1.5"/>
        <circle cx="14" cy="9" r="1.5"/>
      </symbol>
      <symbol id="i-cal" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="14" height="13" rx="2"/>
        <path d="M6 2v3M12 2v3M2 9h14"/>
      </symbol>
      <symbol id="i-users" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="6" r="3"/>
        <path d="M1 16a6 6 0 0 1 12 0"/>
        <path d="M12 4a3 3 0 0 1 0 6M16 16a6 6 0 0 0-5-5.9"/>
      </symbol>
      <symbol id="i-clock" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="9" r="7"/>
        <path d="M9 5v4l3 2"/>
      </symbol>
      <symbol id="i-sun" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="9" r="3.5"/>
        <path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.5 3.5l1.5 1.5M13 13l1.5 1.5M14.5 3.5L13 5M5 13l-1.5 1.5"/>
      </symbol>
      <symbol id="i-link" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 10a3 3 0 0 0 4 4l3-3a3 3 0 0 0-4.24-4.24L9 8"/>
        <path d="M10 8a3 3 0 0 0-4-4L3 7a3 3 0 0 0 4.24 4.24L9 10"/>
      </symbol>
      <symbol id="i-file" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 2H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-5-5z"/>
        <path d="M10 2v5h5"/>
      </symbol>
      <symbol id="i-wallet" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="5" width="16" height="11" rx="2"/>
        <path d="M1 9h16"/>
        <path d="M5 2h8a1 1 0 0 1 1 1v2H4V3a1 1 0 0 1 1-1z"/>
        <circle cx="13" cy="13" r="1" fill="currentColor" stroke="none"/>
      </symbol>
      <symbol id="i-play" viewBox="0 0 18 18" fill="currentColor">
        <path d="M5 3l11 6-11 6V3z"/>
      </symbol>
      <symbol id="i-lock" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="8" width="12" height="9" rx="2"/>
        <path d="M6 8V5a3 3 0 0 1 6 0v3"/>
        <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none"/>
      </symbol>
      <symbol id="i-spark" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 2l1.5 4.5H15l-3.7 2.7 1.4 4.3L9 11l-3.7 2.5 1.4-4.3L3 6.5h4.5L9 2z"/>
      </symbol>
      <symbol id="i-headset" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9a6 6 0 0 1 12 0"/>
        <rect x="1" y="9" width="4" height="5" rx="2"/>
        <rect x="13" y="9" width="4" height="5" rx="2"/>
        <path d="M17 14v1a3 3 0 0 1-3 3h-2"/>
      </symbol>
      <symbol id="i-upload" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2"/>
        <path d="M9 3v9M5 7l4-4 4 4"/>
      </symbol>
      <symbol id="i-wifioff" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 1l16 16"/>
        <path d="M9 15h.01"/>
        <path d="M5.5 11.5A6.5 6.5 0 0 1 9 10.5c1 0 1.9.2 2.7.6"/>
        <path d="M2 8a11 11 0 0 1 5.5-2.9"/>
        <path d="M14.5 7a11 11 0 0 1 1.5 1"/>
      </symbol>
      <symbol id="i-id" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="14" height="10" rx="2"/>
        <circle cx="6" cy="9" r="2"/>
        <path d="M10 7h4M10 11h4"/>
      </symbol>
      <symbol id="i-shield" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 2L3 5v4c0 4 2.7 6.8 6 8 3.3-1.2 6-4 6-8V5L9 2z"/>
        <path d="M6 9l2 2 4-4"/>
      </symbol>
      <symbol id="i-gear" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="9" r="2.5"/>
        <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4"/>
      </symbol>
      <symbol id="i-speaker" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6.5H6L10 3v12l-4-3.5H3V6.5z"/>
        <path d="M13 6a4 4 0 0 1 0 6"/>
      </symbol>
    </svg>
  );
}
