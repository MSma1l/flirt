import * as ImagePicker from 'expo-image-picker';

import { pickStoryMedia } from '../storyPicker';

// expo-image-picker, expo-image-manipulator și File sunt mock-uite în jest.setup.js
// (cazul fericit: permisiune acordată, poză mică, sub limita de upload).

const mockLaunch = ImagePicker.launchImageLibraryAsync as jest.Mock;

const PICKED_IMAGE = {
  canceled: false,
  assets: [
    {
      uri: 'file:///a.jpg',
      width: 1080,
      height: 1920,
      mimeType: 'image/jpeg',
      type: 'image',
    },
  ],
};

describe('pickStoryMedia', () => {
  beforeEach(() => mockLaunch.mockReset());

  it('deschide galeria DOAR pe imagini, fără opțiuni de video', async () => {
    // Story = doar poză: un clip n-ar putea fi moderat automat (Guideline 1.2).
    mockLaunch.mockResolvedValue(PICKED_IMAGE);

    await pickStoryMedia();

    const options = mockLaunch.mock.calls[0][0];
    expect(options.mediaTypes).toEqual(['images']);
    expect(options.videoMaxDuration).toBeUndefined();
  });

  it('împachetează poza aleasă ca media de tip imagine (comprimată)', async () => {
    mockLaunch.mockResolvedValue(PICKED_IMAGE);

    const res = await pickStoryMedia();

    expect(res.status).toBe('picked');
    if (res.status === 'picked') {
      expect(res.file.mediaType).toBe('image');
      expect(res.file.mimeType).toBe('image/jpeg');
    }
  });

  it('galeria închisă fără alegere → cancelled (fără crash)', async () => {
    mockLaunch.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickStoryMedia()).toEqual({ status: 'cancelled' });
  });
});
