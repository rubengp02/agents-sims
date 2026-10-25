export interface OfficePresence {
  id: number;
  name: string;
  project: string;
  provider: string;
  status: 'Trabajando' | 'Disponible' | 'Terminado' | 'En pausa';
}
export interface OfficePresenceSnapshot {
  employees: OfficePresence[];
  sessions: OfficePresence[];
}
