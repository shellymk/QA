// ============================================================
// Tipos das entidades da API (espelham o modelo do MongoDB).
// Com TypeScript, o editor avisa se você acessar um campo que não existe.
// ============================================================

export interface Transcript {
  user: string;
  text: string;
  timestamp: string;
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
}

export interface Analytics {
  meetings: number;
  hours: number;
  minutes: number;
  users: number;
  transcripts: number;
  byDay: Record<string, number>;
}
