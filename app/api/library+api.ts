import { readLibrary } from '@/lib/server-library';

export async function GET() {
  try {
    const library = await readLibrary();
    return Response.json(library);
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取书库失败';
    return Response.json({ error: message }, { status: 500 });
  }
}
