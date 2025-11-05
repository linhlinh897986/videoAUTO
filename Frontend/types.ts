export interface SubtitleBlock {
  id: number;
  startTime: string;
  endTime: string;
  text: string;
  track?: number;
}

export interface KeywordPair {
  id: string;
  find: string;
  replace: string;
}

export interface Character {
  id:string;
  chineseName: string;
  vietnameseName: string;
  relationship: string;
  addressing: string;
  gender?: string;
  age?: string;
}

export interface SrtFile {
  id: string;
  name: string;
  type: 'srt';
  originalSubtitles: SubtitleBlock[];
  translatedSubtitles: SubtitleBlock[];
  translationStatus?: 'success' | 'error';
  tokenCount?: number;
}

export interface BoundingBox {
  x: number; // percentage
  y: number; // percentage
  width: number; // percentage
  height: number; // percentage
  enabled: boolean;
}

export interface VideoSegment {
  id: string;
  sourceStartTime: number;
  sourceEndTime: number;
  playbackRate?: number;
  volumeDb?: number; // Volume adjustment in decibels
}

export interface VideoFile {
  id: string;
  name: string;
  type: 'video';
  segments: VideoSegment[];
  hardsubCoverBox?: BoundingBox;
  masterVolumeDb?: number; // Master volume for the entire video track in dB
  storagePath?: string;
  fileSize?: number;
  uploadedAt?: string;
}

export interface AudioFile {
  id: string;
  name: string;
  type: 'audio';
  duration?: number;
  startTime?: number; // Time in seconds on the timeline
  track?: number;
  storagePath?: string;
  fileSize?: number;
  uploadedAt?: string;
}

export interface ContextItem {
  id: string;
  chineseName: string;
  vietnameseName: string;
  description: string;
}

export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  primaryColor: string;
  outlineColor: string;
  outlineWidth: number;
  verticalMargin: number; // Percentage from the bottom
  horizontalAlign: 'left' | 'center' | 'right';
  videoFrameUrl?: string; // Base64 Data URL for the transparent PNG frame
}

export interface Project {
  id: string;
  name: string;
  stylePrompt: string;
  keywords: KeywordPair[];
  model?: string;
  files: (SrtFile | VideoFile | AudioFile)[];
  characterProfile?: Character[];
  translationConcurrency?: number;
  maxTokensPerRequest?: number;
  keywordHandling?: 'api' | 'post-process' | 'off';
  thinkingEnabled?: boolean;
  locations?: ContextItem[];
  skills?: ContextItem[];
  realms?: ContextItem[];
  subtitleStyle?: SubtitleStyle;
  autoAnalyzeHardsubs?: boolean;
  autoGenerateWaveform?: boolean;
}

export interface CustomStyle {
  id: string;
  name: string;
  prompt: string;
}

// Represents the usage statistics for a single API key.
export interface ApiKeyUsage {
  total: number;
  daily: {
    // Stores usage counts per day, with the date as the key (e.g., "2023-10-27").
    [date: string]: number;
  };
}

// Represents a single API key along with its metadata for advanced management.
export interface ApiKey {
  id: string;          // A unique identifier for the key entry.
  value: string;       // The actual API key string.
  usage: ApiKeyUsage;  // Tracks total and daily usage statistics.
  status: 'active' | 'exhausted'; // The current status of the key.
  lastUsed: number;    // Timestamp of the last time the key was used.
  createdAt: number;   // Timestamp of when the key was added.
}