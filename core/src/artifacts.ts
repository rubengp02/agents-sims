export interface OfficeArtifact {
  id: string;
  name: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  size: number;
  createdAt: string;
  kind: 'attachment' | 'screenshot' | 'generated';
  conversationId?: string;
  taskId?: string;
}

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 10;

export function validateArtifactReference(value: unknown): value is OfficeArtifact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.id === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(a.id) &&
    typeof a.name === 'string' &&
    a.name.length > 0 &&
    a.name.length <= 180 &&
    !/[\\/\u0000-\u001f]/.test(a.name) &&
    ['image/png', 'image/jpeg', 'image/webp'].includes(a.mime as string) &&
    Number.isInteger(a.size) &&
    (a.size as number) > 0 &&
    (a.size as number) <= MAX_IMAGE_BYTES &&
    typeof a.createdAt === 'string' &&
    Number.isFinite(Date.parse(a.createdAt)) &&
    ['attachment', 'screenshot', 'generated'].includes(a.kind as string) &&
    (a.conversationId === undefined || typeof a.conversationId === 'string') &&
    (a.taskId === undefined || typeof a.taskId === 'string') &&
    Object.keys(a).every((key) =>
      ['id', 'name', 'mime', 'size', 'createdAt', 'kind', 'conversationId', 'taskId'].includes(key),
    )
  );
}
