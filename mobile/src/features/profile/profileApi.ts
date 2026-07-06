/** Acces la API pentru profilul propriu (TZ secț. 6.1): citirea profilului curent. */
import { api } from '@/services/api';

/** Profilul propriu în camelCase (folosit pentru pre-completarea formularului). */
export interface MyProfile {
  name: string;
  /** Data nașterii în format ISO (YYYY-MM-DD). */
  birthDate: string;
  gender: string;
  heightCm: number;
  city: string;
  street?: string;
  nationality?: string;
  languages: string[];
  about?: string;
  datingStatuses: string[];
  /** Slug-uri de interese. */
  interests: string[];
  photos: string[];
}

/** Forma brută (snake_case) a profilului venit din backend. */
interface MyProfileResponse {
  name?: string;
  birth_date?: string;
  gender?: string;
  height_cm?: number;
  city?: string;
  street?: string | null;
  nationality?: string | null;
  languages?: string[];
  about?: string | null;
  dating_statuses?: string[];
  interests?: string[];
  photos?: string[];
}

/** Aduce profilul propriu din backend și îl mapează snake_case → camelCase. */
export async function fetchMyProfile(): Promise<MyProfile> {
  const { data } = await api.get<MyProfileResponse>('/profiles/me');
  return {
    name: data.name ?? '',
    birthDate: data.birth_date ?? '',
    gender: data.gender ?? '',
    heightCm: data.height_cm ?? 0,
    city: data.city ?? '',
    street: data.street ?? undefined,
    nationality: data.nationality ?? undefined,
    languages: data.languages ?? [],
    about: data.about ?? undefined,
    datingStatuses: data.dating_statuses ?? [],
    interests: data.interests ?? [],
    photos: data.photos ?? [],
  };
}
