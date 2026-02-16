// Platform-specific config for button injection

export interface Platform {
  host: string;
  platformType: string;
  titleSelectors: string[];
  getPageUrl: () => string;
  getPageTitle: () => string;
  getChannelName: () => string;
}

export const PLATFORMS: Record<string, Platform> = {
  youtube: {
    host: 'www.youtube.com',
    platformType: 'youtube',
    titleSelectors: [
      'ytd-watch-metadata #title',
      '#above-the-fold #title',
      'ytd-video-primary-info-renderer #title',
      '#info-contents #title',
    ],
    getPageUrl: () => location.href,
    getPageTitle: () => {
      const el = document.querySelector(
        'ytd-watch-metadata h1 yt-formatted-string, ' +
        '#above-the-fold h1 yt-formatted-string, ' +
        'ytd-video-primary-info-renderer h1 yt-formatted-string'
      );
      return el ? el.textContent!.trim() : document.title;
    },
    getChannelName: () => {
      const el = document.querySelector('#owner #channel-name a, ytd-channel-name a');
      return el ? el.textContent!.trim() : '';
    },
  },
  bilibili: {
    host: 'www.bilibili.com',
    platformType: 'bilibili',
    titleSelectors: [
      '#viewbox_report .video-title',
      '.video-title',
      '.media-title',
    ],
    getPageUrl: () => location.href,
    getPageTitle: () => {
      const el = document.querySelector(
        '#viewbox_report .video-title, .video-title, .media-title'
      );
      return el ? el.textContent!.trim() : document.title;
    },
    getChannelName: () => {
      const el = document.querySelector('.up-name, #v_upinfo .name a');
      return el ? el.textContent!.trim() : '';
    },
  },
  xiaoyuzhou: {
    host: 'www.xiaoyuzhoufm.com',
    platformType: 'podcast',
    titleSelectors: ['.episode-title', 'h1'],
    getPageUrl: () => location.href,
    getPageTitle: () => {
      const el = document.querySelector('.episode-title, h1');
      return el ? el.textContent!.trim() : document.title;
    },
    getChannelName: () => {
      const el = document.querySelector('.podcast-title, .podcast-name a');
      return el ? el.textContent!.trim() : '';
    },
  },
};

export function detectPlatform(): Platform | null {
  const host = location.hostname;
  for (const key in PLATFORMS) {
    if (host === PLATFORMS[key].host) return PLATFORMS[key];
  }
  return null;
}
