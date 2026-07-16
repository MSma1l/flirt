import * as storyCamera from '../storyCamera';
import { captureStoryPhoto } from '../storyCamera';
import { STORY_MESSAGES } from '../storyLimits';

// compressPhoto / manipulateAsync / File sunt mock-uite în jest.setup.js
// (cazul fericit: poză mică, sub limita de upload).

describe('captureStoryPhoto', () => {
  it('împachetează poza capturată ca media de tip imagine (comprimată)', async () => {
    const camera = {
      takePictureAsync: jest.fn(async () => ({
        uri: 'file:///shot.jpg',
        width: 1080,
        height: 1920,
        format: 'jpg' as const,
      })),
    };

    const res = await captureStoryPhoto(camera);

    expect(camera.takePictureAsync).toHaveBeenCalledWith({ quality: 1 });
    expect(res.status).toBe('captured');
    if (res.status === 'captured') {
      expect(res.file.mediaType).toBe('image');
      expect(res.file.mimeType).toBe('image/jpeg');
      expect(res.file.uri).toContain('shot.jpg');
    }
  });

  it('respinge când camera nu întoarce nicio poză', async () => {
    const camera = { takePictureAsync: jest.fn(async () => undefined) };
    const res = await captureStoryPhoto(camera);
    expect(res).toEqual({ status: 'rejected', message: STORY_MESSAGES.captureFailed });
  });

  it('nu aruncă dacă `takePictureAsync` eșuează', async () => {
    const camera = {
      takePictureAsync: jest.fn(async () => {
        throw new Error('boom');
      }),
    };
    const res = await captureStoryPhoto(camera);
    expect(res).toEqual({ status: 'rejected', message: STORY_MESSAGES.captureFailed });
  });
});

describe('story = doar poză (Apple Guideline 1.2)', () => {
  it('nu expune nicio cale de filmare: modulul are DOAR captura de poză', () => {
    // Video-ul nu poate fi moderat automat → nu-l lăsăm să reapară din reflex.
    expect(Object.keys(storyCamera)).toEqual(['captureStoryPhoto']);
  });
});
