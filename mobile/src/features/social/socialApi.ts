/** Acces la API pentru favorite (TZ secț. 6.1): listare + eliminare. */
import { api } from '@/services/api';

/** Un favorit în camelCase (folosit în ecranul de favorite). */
export interface FavoriteItem {
  targetUserId: string;
  name: string;
  age: number;
  city: string;
}

/** Forma brută (snake_case) a unui favorit venit din backend. */
interface FavoriteResponse {
  target_user_id: string;
  name: string;
  age: number;
  city: string;
}

/** Aduce lista de favorite și o mapează snake_case → camelCase. */
export async function fetchFavorites(): Promise<FavoriteItem[]> {
  const { data } = await api.get<FavoriteResponse[]>('/social/favorites');
  return (data ?? []).map((f) => ({
    targetUserId: f.target_user_id,
    name: f.name,
    age: f.age,
    city: f.city,
  }));
}

/** Scoate un utilizator din favorite. */
export async function removeFavorite(targetUserId: string): Promise<void> {
  await api.delete(`/social/favorites/${targetUserId}`);
}
