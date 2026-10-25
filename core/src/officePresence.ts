export interface OfficePresence {
  id: number;
  name: string;
  project: string;
  provider: string;
  status: 'Trabajando' | 'Disponible' | 'Terminado' | 'En pausa';
  signal?: OfficeWorkSignal;
}
export interface OfficeWorkSignal {
  label: string;
  tone: 'active' | 'paused' | 'done' | 'neutral';
  active: boolean;
  conversationId?: string;
}
export interface OfficePresenceSnapshot {
  employees: OfficePresence[];
  sessions: OfficePresence[];
}
