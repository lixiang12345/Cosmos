import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function StrokeIcon({ children, size = 15, viewBox = '0 0 16 16', ...props }: IconProps & {
  children: ReactNode
  size?: number
  viewBox?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  )
}

export function PrototypeSidebarIcon(props: IconProps) {
  return <StrokeIcon {...props}><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M6.5 2.5v11" /></StrokeIcon>
}

export function PrototypeChevronDownIcon(props: IconProps) {
  return <StrokeIcon size={10} viewBox="0 0 10 10" {...props}><path d="M2 3.5l3 3 3-3" /></StrokeIcon>
}

export function PrototypeChevronRightIcon(props: IconProps) {
  return <StrokeIcon size={12} {...props}><path d="M6 4l4 4-4 4" /></StrokeIcon>
}

export function PrototypeChevronDownLargeIcon(props: IconProps) {
  return <StrokeIcon size={12} {...props}><path d="M4 6l4 4 4-4" /></StrokeIcon>
}

export function PrototypePlusIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M8 3.2v9.6M3.2 8h9.6" /></StrokeIcon>
}

export function PrototypeSessionsIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M3.5 3.5h9a1 1 0 011 1v5.5a1 1 0 01-1 1H7.2L4.5 13.2V11H3.5a1 1 0 01-1-1V4.5a1 1 0 011-1z" /></StrokeIcon>
}

export function PrototypeFolderIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M2.5 4h3.2l1.3 1.3H13.5v7.2a1 1 0 01-1 1h-9a1 1 0 01-1-1V4z" /></StrokeIcon>
}

export function PrototypeFileIcon(props: IconProps) {
  return <StrokeIcon size={14} {...props}><path d="M4.2 2.5h4.3L11.8 5.8V13.5H4.2V2.5z" /><path d="M8.5 2.5V5.8h3.3" /></StrokeIcon>
}

export function PrototypeConfigurationIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M3 4.5h10M3 8h10M3 11.5h10" /><path d="M6 3.5v2M10 7v2M7.5 10.5v2" /></StrokeIcon>
}

export function PrototypeAutomationIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M5.2 10.5c-1.4 0-2.5-1.1-2.5-2.5S3.8 5.5 5.2 5.5c1.1 0 1.9.5 2.8 1.5L8 8l-.05.05C7.1 9.9 6.3 10.5 5.2 10.5zM10.8 5.5c1.4 0 2.5 1.1 2.5 2.5s-1.1 2.5-2.5 2.5c-1.1 0-1.9-.5-2.8-1.5L8 8l.05-.05C8.9 6.1 9.7 5.5 10.8 5.5z" /></StrokeIcon>
}

export function PrototypeHexIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M8 1.75l5.4 3.1v6.3L8 14.25 2.6 11.15v-6.3L8 1.75z" /></StrokeIcon>
}

export function PrototypeSearchIcon(props: IconProps) {
  return <StrokeIcon {...props}><circle cx="7" cy="7" r="4" /><path d="M10.5 10.5L13.2 13.2" /></StrokeIcon>
}

export function PrototypeGitHubIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M8 2.2a5.8 5.8 0 00-1.83 11.3c.3.05.4-.13.4-.28v-1c-1.67.36-2.02-.8-2.02-.8-.27-.7-.67-.88-.67-.88-.55-.37.04-.36.04-.36.6.04.92.62.92.62.54.92 1.4.66 1.75.5.05-.4.21-.66.38-.81-1.33-.15-2.73-.67-2.73-2.96 0-.66.23-1.19.62-1.61-.06-.15-.27-.77.06-1.6 0 0 .5-.16 1.65.62a5.7 5.7 0 013 0c1.14-.78 1.64-.62 1.64-.62.33.83.12 1.45.06 1.6.39.42.62.95.62 1.61 0 2.3-1.4 2.8-2.74 2.95.22.19.41.56.41 1.13v1.68c0 .15.1.34.41.28A5.8 5.8 0 008 2.2z" /></StrokeIcon>
}

export function PrototypeLinearIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M3.5 10.2L10.2 3.5M4.8 12.2a5.2 5.2 0 007.4-7.4" /></StrokeIcon>
}

export function PrototypeSlackIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M5.5 9.5a1.2 1.2 0 01-1.2 1.2H3.1a1.2 1.2 0 010-2.4h1.2a1.2 1.2 0 011.2 1.2zm.6 0a1.2 1.2 0 011.2-1.2h2.4v1.2a1.2 1.2 0 01-2.4 0V9.5zM6.1 5.5A1.2 1.2 0 015 4.3V3.1a1.2 1.2 0 012.4 0v1.2a1.2 1.2 0 01-1.2 1.2zm0 .6a1.2 1.2 0 011.2 1.2v2.4H6.1a1.2 1.2 0 010-2.4V6.1z" /></StrokeIcon>
}

export function PrototypeTopbarSearchIcon(props: IconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <circle cx="6.5" cy="6.5" r="4.5" />
      <path d="M11 11l3 3" />
    </svg>
  )
}

export function PrototypeEnvironmentIcon(props: IconProps) {
  return <StrokeIcon size={14} {...props}><rect x="2.5" y="4.5" width="11" height="8" rx="1.5" /><path d="M5.2 4.5V3.4a1 1 0 011-1h3.6a1 1 0 011 1v1.1" /></StrokeIcon>
}

export function PrototypeToolsIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M5.2 10.8a2.4 2.4 0 01-2.4-2.4V7.2a3.2 3.2 0 015.4-2.3 3.2 3.2 0 015 2.3v1.2a2.4 2.4 0 01-2.4 2.4" /><path d="M5.2 10.8v1.4a1.4 1.4 0 001.4 1.4h2.8a1.4 1.4 0 001.4-1.4v-1.4" /></StrokeIcon>
}

export function PrototypeMoonIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M11.5 9.2A4.5 4.5 0 118 2.8 3.5 3.5 0 0011.5 9.2z" /></StrokeIcon>
}

export function PrototypeSunIcon(props: IconProps) {
  return <StrokeIcon {...props}><circle cx="8" cy="8" r="2.8" /><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1.1 1.1M11.1 11.1l1.1 1.1M3.8 12.2l1.1-1.1M11.1 4.9l1.1-1.1" /></StrokeIcon>
}

export function PrototypeKeyboardIcon(props: IconProps) {
  return <StrokeIcon {...props}><rect x="2" y="4" width="12" height="8" rx="1.5" /><path d="M4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5.5 9.5h5" /></StrokeIcon>
}

export function PrototypeScrollDownIcon(props: IconProps) {
  return <StrokeIcon size={10} viewBox="0 0 12 12" strokeWidth={1.4} {...props}><path d="M3 4.5L6 7.5 9 4.5" /></StrokeIcon>
}

export function PrototypeAgentIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M8 1.75l5.4 3.1v6.3L8 14.25 2.6 11.15v-6.3L8 1.75z" />
      <circle cx="6.5" cy="7.2" r=".65" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="7.2" r=".65" fill="currentColor" stroke="none" />
    </StrokeIcon>
  )
}

export function PrototypeTerminalIcon(props: IconProps) {
  return <StrokeIcon {...props}><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="M5 6.5l2 1.5L5 9.5M8.5 9.5H11" /></StrokeIcon>
}

export function PrototypeSubscriptionsIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h6" /><circle cx="12" cy="11.5" r="1.2" /></StrokeIcon>
}

export function PrototypeCopyIcon(props: IconProps) {
  return <StrokeIcon {...props}><rect x="5.5" y="5.5" width="7" height="7" rx="1" /><path d="M3.5 10.5V3.5a1 1 0 011-1h7" /></StrokeIcon>
}

export function PrototypePanelRightIcon(props: IconProps) {
  return <StrokeIcon {...props}><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M9.5 2.5v11" /></StrokeIcon>
}

export function PrototypePaperclipIcon(props: IconProps) {
  return <StrokeIcon size={16} {...props}><path d="M5.5 8.5l4.2-4.2a2 2 0 012.8 2.8L6.2 13.4a3.2 3.2 0 01-4.5-4.5l6.4-6.4" /></StrokeIcon>
}

export function PrototypePlusCompactIcon(props: IconProps) {
  return <StrokeIcon {...props}><path d="M8 3.5v9M3.5 8h9" /></StrokeIcon>
}
