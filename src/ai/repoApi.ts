import { apiCall } from '@/core/auth/api';
export interface RepoFile { path: string; size: number }
export interface RepoTree { repo: string; ref: string; description: string; private: boolean; truncated: boolean; files: RepoFile[] }
export const REPO_ERR: Record<string, string> = {
  bad_repo: 'Укажите репозиторий как владелец/имя или ссылку github.com', repo_not_found: 'Репозиторий или ветка не найдены (проверьте токен и права)', repo_not_found_or_private: 'Репозиторий не найден. Если он закрытый, добавьте личный токен GitHub',
  ref_not_found: 'Такой ветки нет', bad_token: 'GitHub не принял токен', github_rate_limited: 'GitHub ограничил запросы — подождите или добавьте токен', github_forbidden: 'GitHub отказал в доступе',
  github_unreachable: 'GitHub сейчас недоступен', github_error: 'GitHub ответил ошибкой', prime_required: 'Чтение репозиториев входит в режим «Код» (Sky Prime)', rate_limited: 'Слишком часто — подождите минуту', no_files: 'Отметьте файлы',
};
export const apiRepoTree = (b: { repo: string; ref?: string; token?: string }) => apiCall<RepoTree>('/api/ai/repo/tree', { method: 'POST', body: JSON.stringify(b) });
export const apiRepoFiles = (b: { repo: string; ref?: string; paths: string[]; token?: string }) =>
  apiCall<{ files: { path: string; text: string }[]; skipped: { path: string; reason: string }[] }>('/api/ai/repo/files', { method: 'POST', body: JSON.stringify(b) });
