import { captureStoryPhoto, recordStoryVideo } from '../storyCamera';
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

describe('recordStoryVideo', () => {
  it('împachetează clipul filmat ca media de tip video', async () => {
    const camera = {
      recordAsync: jest.fn(async () => ({ uri: 'file:///clip.mp4' })),
      stopRecording: jest.fn(),
    };

    const res = await recordStoryVideo(camera, 30);

    expect(camera.recordAsync).toHaveBeenCalledWith({ maxDuration: 30 });
    expect(res.status).toBe('recorded');
    if (res.status === 'recorded') {
      expect(res.file.mediaType).toBe('video');
      expect(res.file.mimeType).toBe('video/mp4');
    }
  });

  it('respinge dacă înregistrarea nu produce niciun URI', async () => {
    const camera = {
      recordAsync: jest.fn(async () => undefined),
      stopRecording: jest.fn(),
    };
    const res = await recordStoryVideo(camera, 30);
    expect(res).toEqual({ status: 'rejected', message: STORY_MESSAGES.recordFailed });
  });
});
