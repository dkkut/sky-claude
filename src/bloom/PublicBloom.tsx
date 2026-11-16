/** Публичные страницы Bloom без входа: /b/<id> — публикация, /u/<ник> — публикации автора. Данные — только то, что автор открыл всем. */
import { useEffect, useState } from 'react';
import { uploadUrl } from '@/core/auth/api';

interface PubPost {
  id: string; authorName: string; authorUsername: string; kind: string; text: string;
  title?: string; isBlog?: boolean; isAd?: boolean; adNote?: string; editedAt?: string; createdAt: string;
  tags: string[]; mediaUrl?: string; reactions: number; comments: number; views: number;
}
interface PubAuthor { name: string; username: string; bio: string; posts: PubPost[] }

const get = async <T,>(path: string): Promise<T | null> => {
  try { const r = await fetch(uploadUrl(path)); return r.ok ? await r.json() as T : null; } catch { return null; }
};

const Post = ({ p, link }: { p: PubPost; link?: boolean }) => (
  <article className="rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
    <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]" style={{ color: 'var(--t3)' }}>
      <a href={`/u/${p.authorUsername}`} translate="no" className="font-bold" style={{ color: 'var(--t1)' }}>{p.authorName}</a>
      <span translate="no">@{p.authorUsername}</span>
      <span>{new Date(p.createdAt).toLocaleDateString()}{p.editedAt ? ' · изменено' : ''}</span>
      {p.isAd && <span className="rounded px-1.5 py-px text-[10px] font-bold" style={{ background: 'rgba(255,122,0,.15)', color: '#ff7a00' }}>{p.adNote ? `Реклама · ${p.adNote}` : 'Реклама'}</span>}
    </div>
    {p.isBlog && p.title && <h2 translate="no" className="mb-1 text-lg font-bold" style={{ color: 'var(--t1)' }}>{p.title}</h2>}
    {p.text && <p translate="no" className="whitespace-pre-line text-sm leading-relaxed" style={{ color: 'var(--t1)' }}>{p.text}</p>}
    {p.mediaUrl && (p.kind === 'video'
      ? <video src={uploadUrl(p.mediaUrl)} controls playsInline className="mt-3 w-full rounded-xl" style={{ maxHeight: 480 }} />
      : <img src={uploadUrl(p.mediaUrl)} alt="" className="mt-3 w-full rounded-xl object-cover" />)}
    {link && <a href={`/b/${p.id}`} className="mt-3 inline-block text-xs font-semibold" style={{ color: 'var(--accent)' }}>Открыть</a>}
  </article>
);

export const PublicBloom = ({ kind, id }: { kind: 'post' | 'author'; id: string }) => {
  const [post, setPost] = useState<PubPost | null>(null);
  const [author, setAuthor] = useState<PubAuthor | null>(null);
  const [state, setState] = useState<'load' | 'ok' | 'none'>('load');
  useEffect(() => {
    let alive = true;
    (async () => {
      if (kind === 'post') { const r = await get<{ post: PubPost }>(`/api/bloom/public/post/${encodeURIComponent(id)}`); if (!alive) return; setPost(r?.post ?? null); setState(r?.post ? 'ok' : 'none'); }
      else { const r = await get<{ author: PubAuthor }>(`/api/bloom/public/author/${encodeURIComponent(id)}`); if (!alive) return; setAuthor(r?.author ?? null); setState(r?.author ? 'ok' : 'none'); }
    })();
    return () => { alive = false; };
  }, [kind, id]);
  return (
    <div className="min-h-screen px-4 py-8" style={{ background: 'var(--bg)', color: 'var(--t1)' }}>
      <div className="mx-auto w-full max-w-xl space-y-3">
        <a href="/" className="text-sm font-bold" style={{ color: 'var(--accent)' }}>Sky · Bloom</a>
        {state === 'load' && <p className="text-sm" style={{ color: 'var(--t3)' }}>Загрузка…</p>}
        {state === 'none' && <p className="text-sm" style={{ color: 'var(--t3)' }}>Публикация не найдена или недоступна по ссылке.</p>}
        {state === 'ok' && post && <Post p={post} />}
        {state === 'ok' && author && (
          <>
            <header className="mb-2">
              <h1 translate="no" className="text-xl font-bold">{author.name}</h1>
              <p translate="no" className="text-[13px]" style={{ color: 'var(--t3)' }}>@{author.username}</p>
              {author.bio && <p translate="no" className="mt-1 text-sm">{author.bio}</p>}
            </header>
            {author.posts.length === 0 && <p className="text-sm" style={{ color: 'var(--t3)' }}>Публикаций пока нет.</p>}
            {author.posts.map(p => <Post key={p.id} p={p} link />)}
          </>
        )}
        <p className="pt-4 text-[11px]" style={{ color: 'var(--t3)' }}>Чтобы ставить реакции и комментировать, войдите в Sky.</p>
      </div>
    </div>
  );
};
