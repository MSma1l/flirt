import {
  formatMb,
  PHOTO_LIMITS,
  resizeTarget,
  validateCanAddPhoto,
  validatePhotoCount,
  validatePhotoSize,
  validateSourceType,
  validateUploadType,
} from '../validation';

describe('limitele de poze', () => {
  it('sunt simetrice cu backend-ul (min 1, max 9, 8 MB, jpeg/png/webp)', () => {
    expect(PHOTO_LIMITS.min).toBe(1);
    expect(PHOTO_LIMITS.max).toBe(9);
    expect(PHOTO_LIMITS.maxUploadBytes).toBe(8_388_608);
    expect(PHOTO_LIMITS.allowedTypes).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });
});

describe('validateSourceType', () => {
  it('acceptă tipurile permise de backend', () => {
    expect(validateSourceType('image/jpeg')).toBeNull();
    expect(validateSourceType('image/png')).toBeNull();
    expect(validateSourceType('image/webp')).toBeNull();
  });

  it('acceptă HEIC/HEIF (le convertim noi la JPEG)', () => {
    expect(validateSourceType('image/heic')).toBeNull();
    expect(validateSourceType('image/heif')).toBeNull();
  });

  it('acceptă tipul lipsă (unele Content-Provider-e Android nu îl raportează)', () => {
    expect(validateSourceType(undefined)).toBeNull();
    expect(validateSourceType(null)).toBeNull();
  });

  it('respinge tipurile nepermise cu un mesaj clar', () => {
    expect(validateSourceType('image/gif')).toMatch(/Tip de fișier nepermis/);
    expect(validateSourceType('video/mp4')).toMatch(/JPEG, PNG sau WEBP/);
  });
});

describe('validateUploadType', () => {
  it('la upload allowlist-ul e strict cel al backend-ului (fără HEIC)', () => {
    expect(validateUploadType('image/jpeg')).toBeNull();
    expect(validateUploadType('image/heic')).toMatch(/Tip de fișier nepermis/);
  });
});

describe('validatePhotoSize', () => {
  it('acceptă o poză sub limita de 8 MB', () => {
    expect(validatePhotoSize(2 * 1024 * 1024)).toBeNull();
    expect(validatePhotoSize(PHOTO_LIMITS.maxUploadBytes)).toBeNull();
  });

  it('respinge o poză peste limită, spunând cât are și cât se poate', () => {
    const message = validatePhotoSize(12 * 1024 * 1024);
    expect(message).toContain('12 MB');
    expect(message).toContain('8 MB');
  });
});

describe('validatePhotoCount', () => {
  it('cere minimul de poze și spune câte mai lipsesc', () => {
    expect(validatePhotoCount(0)).toContain('cel puțin 1 poze');
    expect(validatePhotoCount(0)).toContain('mai ai 1 de adăugat');
  });

  it('acceptă între min și max', () => {
    expect(validatePhotoCount(1)).toBeNull();
    expect(validatePhotoCount(9)).toBeNull();
  });

  it('respinge peste maxim', () => {
    expect(validatePhotoCount(10)).toContain('maximum 9');
  });
});

describe('validateCanAddPhoto', () => {
  it('blochează adăugarea peste maxim', () => {
    expect(validateCanAddPhoto(8)).toBeNull();
    expect(validateCanAddPhoto(9)).toContain('numărul maxim de 9 poze');
  });
});

describe('resizeTarget', () => {
  it('redimensionează după latura mare (landscape → width)', () => {
    expect(resizeTarget(4032, 3024)).toEqual({ width: 1920 });
  });

  it('redimensionează după latura mare (portrait → height)', () => {
    expect(resizeTarget(3024, 4032)).toEqual({ height: 1920 });
  });

  it('nu mărește niciodată o poză deja mică', () => {
    expect(resizeTarget(800, 600)).toBeNull();
    expect(resizeTarget(1920, 1080)).toBeNull();
  });
});

describe('formatMb', () => {
  it('formatează în MB, fără zecimale inutile', () => {
    expect(formatMb(8_388_608)).toBe('8 MB');
    expect(formatMb(1_572_864)).toBe('1.5 MB');
  });
});
