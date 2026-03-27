/**
 * EJE TikTok Publishing UI
 * Vanilla JS — no frameworks, no build tools.
 * All dynamic text uses textContent / DOM APIs — never innerHTML.
 */
const App = (() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let accessToken = null;
  let creatorInfo = null;
  let selectedContent = null;
  let publishId = null;
  let pollTimer = null;

  const API_BASE = 'https://eirwintest.thefuturen8n.com';
  const CLIENT_KEY = 'YOUR_TIKTOK_CLIENT_KEY';
  const REDIRECT_URI =
    'https://elliottjaz-rgb.github.io/eje-platform/app/publish.html';

  const PRIVACY_LABELS = {
    PUBLIC_TO_EVERYONE: 'Public',
    MUTUAL_FOLLOW_FRIENDS: 'Friends',
    SELF_ONLY: 'Only me',
    FOLLOWER_OF_CREATOR: 'Followers',
  };

  // ---------------------------------------------------------------------------
  // DOM references (cached after DOMContentLoaded)
  // ---------------------------------------------------------------------------
  let els = {};

  function cacheElements() {
    const ids = [
      'connect-btn',
      'connected-state',
      'connected-avatar',
      'connected-nickname',
      'disconnect-btn',
      'login-section',
      'creator-info',
      'creator-avatar',
      'creator-nickname',
      'capabilities-list',
      'content-queue',
      'queue-loading',
      'queue-empty',
      'queue-grid',
      'refresh-queue-btn',
      'post-form',
      'video-preview',
      'video-source',
      'caption-input',
      'char-count',
      'privacy-level',
      'allow-comment',
      'allow-duet',
      'allow-stitch',
      'duet-label',
      'stitch-label',
      'disclosure-toggle',
      'disclosure-options',
      'disclosure-message',
      'disclosure-label',
      'brand-organic',
      'brand-content',
      'aigc-toggle',
      'consent-declaration',
      'publish-btn',
      'publish-status',
      'status-content',
      'status-message',
    ];
    ids.forEach((id) => {
      els[camel(id)] = document.getElementById(id);
    });
  }

  /** kebab-case → camelCase */
  function camel(s) {
    return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function show(el) {
    el.classList.remove('hidden');
  }
  function hide(el) {
    el.classList.add('hidden');
  }

  function generateState() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function apiFetch(path, options = {}) {
    const url = API_BASE + path;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      return res.json();
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error('Request timed out. Please check your connection and try again.');
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // OAuth
  // ---------------------------------------------------------------------------

  function initOAuth() {
    const state = generateState();
    sessionStorage.setItem('tt_oauth_state', state);
    const params = new URLSearchParams({
      client_key: CLIENT_KEY,
      scope: 'user.info.basic,video.upload,video.publish',
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      state: state,
    });
    window.location.href =
      'https://www.tiktok.com/v2/auth/authorize/?' + params.toString();
  }

  function handleOAuthRedirect() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');

    if (!code) return;

    // CSRF check
    const savedState = sessionStorage.getItem('tt_oauth_state');
    if (state !== savedState) {
      sessionStorage.removeItem('tt_oauth_state');
      showStatusMessage('OAuth state mismatch. Please try connecting again.', 'error');
      return;
    }
    sessionStorage.removeItem('tt_oauth_state');

    // Clean URL without reloading
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);

    // For TikTok sandbox / demo: treat the code as the access token.
    // In production the code would be exchanged server-side for a real token.
    accessToken = code;
    onConnected();
  }

  function onConnected() {
    hide(els.connectBtn);
    show(els.connectedState);
    fetchCreatorInfo();
  }

  function disconnect() {
    accessToken = null;
    creatorInfo = null;
    selectedContent = null;
    publishId = null;
    if (pollTimer) clearInterval(pollTimer);

    show(els.connectBtn);
    hide(els.connectedState);
    hide(els.creatorInfo);
    hide(els.contentQueue);
    hide(els.postForm);
    hide(els.publishStatus);

    els.connectedNickname.textContent = '';
    els.connectedAvatar.src = '';
    els.queueGrid.replaceChildren();
  }

  // ---------------------------------------------------------------------------
  // Creator Info
  // ---------------------------------------------------------------------------

  async function fetchCreatorInfo() {
    try {
      const res = await apiFetch('/webhook/tt-creator-info', {
        body: { access_token: accessToken },
      });
      creatorInfo = res.data || res;
      renderCreatorInfo();
      fetchContentQueue();
    } catch (err) {
      showStatusMessage('Failed to fetch account info: ' + err.message, 'error');
    }
  }

  function renderCreatorInfo() {
    const info = creatorInfo;

    // Connected state in login section
    els.connectedAvatar.src = info.creator_avatar_url || '';
    els.connectedAvatar.alt = (info.creator_nickname || 'User') + ' avatar';
    els.connectedNickname.textContent = '@' + (info.creator_nickname || 'user');

    // Creator info card
    els.creatorAvatar.src = info.creator_avatar_url || '';
    els.creatorAvatar.alt = (info.creator_nickname || 'User') + ' avatar';
    els.creatorNickname.textContent = '@' + (info.creator_nickname || 'user');

    // Capabilities list
    els.capabilitiesList.replaceChildren();
    const caps = [
      {
        label: 'Max video duration',
        value: (info.max_video_post_duration_sec || 0) + 's',
      },
      {
        label: 'Comments',
        value: info.comment_disabled ? 'Disabled by account' : 'Available',
      },
      {
        label: 'Duet',
        value: info.duet_disabled ? 'Disabled by account' : 'Available',
      },
      {
        label: 'Stitch',
        value: info.stitch_disabled ? 'Disabled by account' : 'Available',
      },
    ];
    caps.forEach((cap) => {
      const li = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = cap.label + ': ';
      li.appendChild(strong);
      const span = document.createElement('span');
      span.textContent = cap.value;
      li.appendChild(span);
      els.capabilitiesList.appendChild(li);
    });

    show(els.creatorInfo);

    // Populate privacy dropdown
    populatePrivacyDropdown(info.privacy_level_options || []);

    // Configure interaction checkboxes
    configureInteractions(info);
  }

  function populatePrivacyDropdown(options) {
    const select = els.privacyLevel;
    // Remove all except the placeholder
    while (select.options.length > 1) {
      select.remove(1);
    }
    // Reset to placeholder
    select.selectedIndex = 0;
    options.forEach((val) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = PRIVACY_LABELS[val] || val;
      select.appendChild(opt);
    });
  }

  function configureInteractions(info) {
    if (info.duet_disabled) {
      els.allowDuet.disabled = true;
      els.allowDuet.checked = false;
      els.duetLabel.title = 'This feature is not available for your account';
      els.duetLabel.classList.add('disabled');
    } else {
      els.allowDuet.disabled = false;
      els.duetLabel.title = '';
      els.duetLabel.classList.remove('disabled');
    }

    if (info.stitch_disabled) {
      els.allowStitch.disabled = true;
      els.allowStitch.checked = false;
      els.stitchLabel.title = 'This feature is not available for your account';
      els.stitchLabel.classList.add('disabled');
    } else {
      els.allowStitch.disabled = false;
      els.stitchLabel.title = '';
      els.stitchLabel.classList.remove('disabled');
    }
  }

  // ---------------------------------------------------------------------------
  // Content Queue
  // ---------------------------------------------------------------------------

  async function fetchContentQueue() {
    show(els.contentQueue);
    show(els.queueLoading);
    hide(els.queueEmpty);
    els.queueGrid.replaceChildren();

    try {
      const res = await apiFetch('/webhook/tt-content-queue', {
        headers: { 'X-Webhook-Auth-Token': accessToken },
      });
      const items = res.items || [];
      hide(els.queueLoading);

      if (items.length === 0) {
        show(els.queueEmpty);
        return;
      }

      items.forEach((item) => {
        els.queueGrid.appendChild(createContentCard(item));
      });
    } catch (err) {
      hide(els.queueLoading);
      showStatusMessage('Failed to load content queue: ' + err.message, 'error');
    }
  }

  function createContentCard(item) {
    const card = document.createElement('div');
    card.className = 'content-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('data-record-id', item.record_id || '');

    // Thumbnail
    const thumb = document.createElement('div');
    thumb.className = 'card-thumb';
    if (item.thumbnail_url) {
      const img = document.createElement('img');
      img.src = item.thumbnail_url;
      img.alt = 'Video thumbnail';
      img.width = 180;
      img.height = 320;
      thumb.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'thumb-placeholder';
      placeholder.textContent = 'No preview';
      thumb.appendChild(placeholder);
    }
    card.appendChild(thumb);

    // Info
    const info = document.createElement('div');
    info.className = 'card-info';

    const caption = document.createElement('p');
    caption.className = 'card-caption';
    caption.textContent =
      (item.caption || '').length > 80
        ? item.caption.substring(0, 80) + '...'
        : item.caption || 'No caption';
    info.appendChild(caption);

    if (item.hashtags) {
      const tags = document.createElement('p');
      tags.className = 'card-tags';
      tags.textContent = item.hashtags;
      info.appendChild(tags);
    }

    card.appendChild(info);

    // Click handler
    const handleSelect = () => selectContent(item);
    card.addEventListener('click', handleSelect);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSelect();
      }
    });

    return card;
  }

  // ---------------------------------------------------------------------------
  // Select Content → Populate Form
  // ---------------------------------------------------------------------------

  function selectContent(item) {
    selectedContent = item;

    // Highlight selected card
    const cards = els.queueGrid.querySelectorAll('.content-card');
    cards.forEach((c) => {
      c.classList.remove('selected');
      if (c.getAttribute('data-record-id') === item.record_id) {
        c.classList.add('selected');
      }
    });

    // Video
    els.videoSource.src = item.video_url || '';
    els.videoPreview.load();

    // Caption
    const fullCaption =
      (item.caption || '') + (item.hashtags ? '\n' + item.hashtags : '');
    els.captionInput.value = fullCaption;
    els.charCount.textContent = fullCaption.length;

    // Reset form
    els.privacyLevel.selectedIndex = 0;
    els.allowComment.checked = false;
    els.disclosureToggle.checked = false;
    hide(els.disclosureOptions);
    hide(els.disclosureMessage);
    hide(els.disclosureLabel);
    els.brandOrganic.checked = false;
    els.brandContent.checked = false;
    els.aigcToggle.checked = false;

    updateConsentText();
    updatePublishButtonState();

    show(els.postForm);
    hide(els.publishStatus);

    // Scroll to form
    els.postForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------------------------------------------------------------------------
  // Disclosure Logic
  // ---------------------------------------------------------------------------

  function updateDisclosureState() {
    const disclosureOn = els.disclosureToggle.checked;

    if (disclosureOn) {
      show(els.disclosureOptions);
    } else {
      hide(els.disclosureOptions);
      els.brandOrganic.checked = false;
      els.brandContent.checked = false;
      hide(els.disclosureMessage);
      hide(els.disclosureLabel);

      // Re-enable SELF_ONLY in dropdown if it was disabled
      enableSelfOnly();
    }

    updateDisclosureLabels();
    updateConsentText();
    updatePublishButtonState();
  }

  function updateDisclosureLabels() {
    const disclosureOn = els.disclosureToggle.checked;
    const organic = els.brandOrganic.checked;
    const branded = els.brandContent.checked;

    // Reset messages
    hide(els.disclosureMessage);
    hide(els.disclosureLabel);
    els.disclosureMessage.textContent = '';
    els.disclosureLabel.textContent = '';

    if (!disclosureOn) return;

    if (!organic && !branded) {
      // Neither sub-checkbox checked
      show(els.disclosureMessage);
      els.disclosureMessage.textContent =
        'You need to indicate if your content promotes yourself, a third party, or both.';
      els.disclosureMessage.className = 'disclosure-message warning';
    } else if (organic && !branded) {
      show(els.disclosureLabel);
      els.disclosureLabel.textContent =
        'Your photo/video will be labeled as "Promotional content"';
      els.disclosureLabel.className = 'disclosure-label info';
      // Re-enable SELF_ONLY
      enableSelfOnly();
    }

    if (branded) {
      show(els.disclosureLabel);
      els.disclosureLabel.textContent =
        'Your photo/video will be labeled as "Paid partnership"';
      els.disclosureLabel.className = 'disclosure-label info';
      // Disable SELF_ONLY, auto-switch if selected
      disableSelfOnly();
    } else {
      enableSelfOnly();
    }

    updateConsentText();
    updatePublishButtonState();
  }

  function disableSelfOnly() {
    const select = els.privacyLevel;
    for (let i = 0; i < select.options.length; i++) {
      if (select.options[i].value === 'SELF_ONLY') {
        select.options[i].disabled = true;
        select.options[i].title = 'Branded content must be public';
        // If currently selected, auto-switch to PUBLIC_TO_EVERYONE
        if (select.value === 'SELF_ONLY') {
          // Find PUBLIC_TO_EVERYONE option
          for (let j = 0; j < select.options.length; j++) {
            if (select.options[j].value === 'PUBLIC_TO_EVERYONE') {
              select.selectedIndex = j;
              break;
            }
          }
        }
        break;
      }
    }
  }

  function enableSelfOnly() {
    const select = els.privacyLevel;
    for (let i = 0; i < select.options.length; i++) {
      if (select.options[i].value === 'SELF_ONLY') {
        select.options[i].disabled = false;
        select.options[i].title = '';
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Publish Button State
  // ---------------------------------------------------------------------------

  function updatePublishButtonState() {
    const privacySelected = els.privacyLevel.value !== '';
    const disclosureOn = els.disclosureToggle.checked;
    const organic = els.brandOrganic.checked;
    const branded = els.brandContent.checked;

    let disclosureValid = true;
    if (disclosureOn && !organic && !branded) {
      disclosureValid = false;
    }

    els.publishBtn.disabled = !(privacySelected && disclosureValid);
  }

  // ---------------------------------------------------------------------------
  // Consent Declaration — built entirely with DOM methods
  // ---------------------------------------------------------------------------

  function updateConsentText() {
    const container = els.consentDeclaration;
    container.replaceChildren();

    const text1 = document.createTextNode('By posting, you agree to TikTok\u2019s ');
    container.appendChild(text1);

    const musicLink = document.createElement('a');
    musicLink.setAttribute(
      'href',
      'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en'
    );
    musicLink.setAttribute('target', '_blank');
    musicLink.setAttribute('rel', 'noopener noreferrer');
    musicLink.textContent = 'Music Usage Confirmation';
    container.appendChild(musicLink);

    if (els.brandContent.checked) {
      const text2 = document.createTextNode(' and ');
      container.appendChild(text2);

      const bcLink = document.createElement('a');
      bcLink.setAttribute(
        'href',
        'https://www.tiktok.com/legal/page/global/bc-policy/en'
      );
      bcLink.setAttribute('target', '_blank');
      bcLink.setAttribute('rel', 'noopener noreferrer');
      bcLink.textContent = 'Branded Content Policy';
      container.appendChild(bcLink);
    }

    const period = document.createTextNode('.');
    container.appendChild(period);
  }

  // ---------------------------------------------------------------------------
  // Publish
  // ---------------------------------------------------------------------------

  async function publishContent() {
    if (!selectedContent || !accessToken) return;

    els.publishBtn.disabled = true;
    els.publishBtn.textContent = 'Publishing...';
    show(els.publishStatus);
    setStatusLoading(
      'Your video is being uploaded. Please wait...'
    );

    try {
      const body = {
        access_token: accessToken,
        video_url: selectedContent.video_url,
        title: els.captionInput.value,
        privacy_level: els.privacyLevel.value,
        disable_comment: !els.allowComment.checked,
        disable_duet: !els.allowDuet.checked,
        disable_stitch: !els.allowStitch.checked,
        brand_content_toggle: els.brandContent.checked,
        brand_organic_toggle: els.brandOrganic.checked,
        is_aigc: els.aigcToggle.checked,
        record_id: selectedContent.record_id,
      };

      const res = await apiFetch('/webhook/tt-publish', { body });
      publishId = res.publish_id;

      setStatusLoading(
        'Your video is being processed. It may take a few minutes to appear on your profile.'
      );

      pollPublishStatus(publishId);
    } catch (err) {
      showStatusMessage('Publishing failed: ' + err.message, 'error');
      els.publishBtn.disabled = false;
      els.publishBtn.textContent = 'Post to TikTok';
    }
  }

  function pollPublishStatus(pid) {
    let attempts = 0;
    const MAX_ATTEMPTS = 12;

    pollTimer = setInterval(async () => {
      attempts++;
      try {
        const res = await apiFetch('/webhook/tt-publish-status', {
          body: { access_token: accessToken, publish_id: pid },
        });

        const status = (res.status || '').toUpperCase();

        if (status === 'PUBLISH_COMPLETE' || status === 'SUCCESS') {
          clearInterval(pollTimer);
          pollTimer = null;
          showStatusMessage(
            'Video published successfully! (ID: ' + pid + ')',
            'success'
          );
          els.publishBtn.textContent = 'Post to TikTok';
          return;
        }

        if (status === 'FAILED' || status === 'ERROR') {
          clearInterval(pollTimer);
          pollTimer = null;
          showStatusMessage(
            'Publishing failed. Please try again.',
            'error'
          );
          els.publishBtn.disabled = false;
          els.publishBtn.textContent = 'Post to TikTok';
          return;
        }
      } catch (err) {
        // Network error during poll — continue trying
      }

      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(pollTimer);
        pollTimer = null;
        showStatusMessage(
          'Still processing... Your video may take longer to appear. Check your TikTok profile shortly.',
          'warning'
        );
        els.publishBtn.disabled = false;
        els.publishBtn.textContent = 'Post to TikTok';
      }
    }, 5000);
  }

  // ---------------------------------------------------------------------------
  // Status Messages
  // ---------------------------------------------------------------------------

  function setStatusLoading(msg) {
    const container = els.statusContent;
    container.replaceChildren();

    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    container.appendChild(spinner);

    const p = document.createElement('p');
    p.textContent = msg;
    container.appendChild(p);
  }

  function showStatusMessage(msg, type) {
    show(els.publishStatus);
    const container = els.statusContent;
    container.replaceChildren();

    const icon = document.createElement('span');
    icon.className = 'status-icon status-' + type;
    if (type === 'success') icon.textContent = '\u2713';
    else if (type === 'error') icon.textContent = '\u2717';
    else if (type === 'warning') icon.textContent = '\u26A0';
    container.appendChild(icon);

    const p = document.createElement('p');
    p.className = 'status-text status-' + type;
    p.textContent = msg;
    container.appendChild(p);
  }

  // ---------------------------------------------------------------------------
  // Event Binding
  // ---------------------------------------------------------------------------

  function bindEvents() {
    // Connect / disconnect
    els.connectBtn.addEventListener('click', initOAuth);
    els.disconnectBtn.addEventListener('click', disconnect);

    // Refresh queue
    els.refreshQueueBtn.addEventListener('click', fetchContentQueue);

    // Caption char counter
    els.captionInput.addEventListener('input', () => {
      els.charCount.textContent = els.captionInput.value.length;
    });

    // Privacy dropdown
    els.privacyLevel.addEventListener('change', updatePublishButtonState);

    // Disclosure toggle
    els.disclosureToggle.addEventListener('change', updateDisclosureState);
    els.brandOrganic.addEventListener('change', updateDisclosureLabels);
    els.brandContent.addEventListener('change', updateDisclosureLabels);

    // Publish button
    els.publishBtn.addEventListener('click', publishContent);
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  function init() {
    cacheElements();
    bindEvents();
    updateConsentText();
    handleOAuthRedirect();
  }

  document.addEventListener('DOMContentLoaded', init);

  // Public API (for debugging only)
  return { init };
})();
