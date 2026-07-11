// ============================================================
// Tipos das entidades da API (espelham o modelo do MongoDB).
// Com TypeScript, o editor avisa se você acessar um campo que não existe.
// ============================================================

export interface Transcript {
  user: string;
  text: string;
  timestamp: string;
  confianca?: number; // 0..1 — baixo = identificação incerta (fala sobreposta)
}

export interface Meeting {
  _id: string;
  title: string;
  meetingCode: string | null;
  createdAt: string;
  finishedAt: string | null;
  duration: number | null;
  participants: string[];
  transcripts?: Transcript[];
  status?: 'live' | 'finished';
  origem?: string;              // 'upload' | (live/antiga) — usado p/ agrupar por plataforma
  deletedAt?: string | null;    // preenchido = está na lixeira (soft-delete)
  temMidia?: boolean;           // tem gravação (vídeo/áudio) pra tocar (Etapa 5)
  mediaTipo?: string;           // content-type da gravação (ex.: 'video/webm')
}

// Fala diarizada devolvida pelo /api/transcrever-upload (via AssemblyAI).
export interface Fala {
  speaker: string;   // "Pessoa A", "Pessoa B"…
  text: string;
  start: number;     // ms desde o início do áudio
  end: number;
  confianca?: number; // 0..1 — baixo = identificação incerta
}

export interface RespostaUpload {
  success: boolean;
  meetingId: string;
  transcricao: { texto: string; falas: Fala[]; duracaoSeg?: number; pessoas: number };
}

export interface Analytics {
  meetings: number;
  hours: number;
  minutes: number;
  users: number;
  transcripts: number;
  byDay: Record<string, number>;
}
