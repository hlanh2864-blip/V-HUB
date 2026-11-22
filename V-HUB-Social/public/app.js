'use strict';

const state = {
  user: null,
  csrfToken: '',
  filter: 'all',
  activeView: 'feed',
  currentProfile: null,
  currentCommentPost: null,
  authMode: 'login',
  suggestions: [],
  searchTimer: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

async function api(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (options.body && typeof options.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && state.csrfToken) {
    headers['X-CSRF-Token'] = state.csrfToken;
  }
  const response = await fetch(url, { ...options, method, headers, credentials: 'same-origin' });
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    if (response.status === 401 && state.user) {
      state.user = null;
      updateUserUI();
    }
    throw new Error(data.error || 'Đã xảy ra lỗi. Vui lòng thử lại.');
  }
  if (data.csrfToken) state.csrfToken = data.csrfToken;
  return data;
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  $('#toastRegion').append(toast);
  setTimeout(() => toast.remove(), 3200);
}

function initials(value) {
  const text = String(value || 'V').trim();
  return (text[0] || 'V').toUpperCase();
}

function makeAvatar(user, className = 'avatar') {
  const avatar = document.createElement('div');
  avatar.className = className;
  avatar.textContent = initials(user?.displayName || user?.username);
  if (user?.avatarUrl) {
    const img = document.createElement('img');
    img.src = user.avatarUrl;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove(), { once: true });
    avatar.textContent = '';
    avatar.append(img);
  }
  return avatar;
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(String(value).includes('T') ? value : value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return '';
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return date.toLocaleDateString('vi-VN');
}

function setView(view) {
  state.activeView = view;
  $$('.view').forEach(section => section.classList.toggle('active', section.id === `${view}View`));
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view && (view !== 'feed' || item.dataset.filter === state.filter)));
  const headings = {
    feed: ['KHÔNG GIAN CỘNG ĐỒNG', state.filter === 'following' ? 'Đang theo dõi' : 'Bảng tin'],
    profile: ['YOUR PERSONAL SPACE', 'Trang cá nhân'],
    notifications: ['CẬP NHẬT MỚI', 'Thông báo'],
    search: ['KHÁM PHÁ CỘNG ĐỒNG', 'Tìm kiếm']
  };
  $('#pageEyebrow').textContent = headings[view]?.[0] || 'V-HUB SOCIAL';
  $('#pageTitle').textContent = headings[view]?.[1] || 'V-HUB';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateUserUI() {
  const user = state.user;
  const sidebarAvatar = $('#sidebarAvatar');
  const composerAvatar = $('#composerAvatar');
  const topAvatar = $('#topAvatar');
  const peekAvatar = $('#peekAvatar');
  [sidebarAvatar, composerAvatar, topAvatar, peekAvatar].forEach(node => {
    node.replaceChildren();
    node.textContent = initials(user?.displayName || user?.username || 'V');
    if (user?.avatarUrl) {
      const img = document.createElement('img');
      img.src = user.avatarUrl;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.remove(), { once: true });
      node.textContent = '';
      node.append(img);
    }
  });
  $('#sidebarName').textContent = user?.displayName || 'Khách ghé thăm';
  $('#sidebarHandle').textContent = user ? `@${user.username}` : 'Chưa đăng nhập';
  $('#sidebarAccountAction').textContent = user ? '↪' : '↗';
  $('#sidebarAccountAction').title = user ? 'Đăng xuất' : 'Đăng nhập';
  $('#topAvatar').title = user ? 'Mở hồ sơ cá nhân' : 'Đăng nhập';
  $('#peekName').textContent = user?.displayName || 'Khách ghé thăm';
  $('#peekHandle').textContent = user ? `@${user.username}` : '@guest';
  $('#peekBio').textContent = user?.bio || 'Đăng nhập để tạo hồ sơ cá nhân của bạn.';
  $('#welcomeBanner').classList.toggle('hidden', Boolean(user));
  $('#composerFocus').textContent = user ? 'Bạn đang nghĩ gì?' : 'Đăng nhập để chia sẻ điều bạn nghĩ...';
  $('#postBody').placeholder = user ? 'Chia sẻ một điều thú vị với cộng đồng...' : 'Đăng nhập để viết bài đăng...';
  $('#postBody').disabled = !user;
  $('#publishPost').textContent = user ? 'Đăng bài ↗' : 'Đăng nhập ↗';
  if (user) loadMyStats();
  else {
    $('#peekPosts').textContent = '—';
    $('#peekFollowers').textContent = '—';
    $('#peekFollowing').textContent = '—';
  }
}

async function loadMyStats() {
  if (!state.user) return;
  try {
    const data = await api(`/api/users/${encodeURIComponent(state.user.username)}`);
    $('#peekPosts').textContent = data.profile.postsCount;
    $('#peekFollowers').textContent = data.profile.followers;
    $('#peekFollowing').textContent = data.profile.following;
  } catch { /* Keep the profile summary usable if this request fails. */ }
}

function renderPost(post) {
  const card = document.createElement('article');
  card.className = 'post-card';
  card.dataset.postId = post.id;

  const head = document.createElement('div');
  head.className = 'post-head';
  const avatar = makeAvatar(post.author, 'avatar');
  avatar.style.cursor = 'pointer';
  avatar.dataset.user = post.author.username;
  head.append(avatar);

  const author = document.createElement('div');
  author.className = 'post-author';
  const name = document.createElement('strong');
  name.textContent = post.author.displayName;
  name.dataset.user = post.author.username;
  const meta = document.createElement('span');
  meta.textContent = `@${post.author.username} · ${formatTime(post.createdAt)}`;
  author.append(name, meta);
  head.append(author);

  if (post.isMine) {
    const del = document.createElement('button');
    del.className = 'post-delete';
    del.type = 'button';
    del.dataset.deletePost = post.id;
    del.title = 'Xóa bài đăng';
    del.textContent = '•••';
    head.append(del);
  }
  card.append(head);

  const body = document.createElement('p');
  body.className = 'post-body';
  body.textContent = post.body;
  card.append(body);
  if (post.imageUrl) {
    const img = document.createElement('img');
    img.className = 'post-image';
    img.src = post.imageUrl;
    img.alt = 'Ảnh trong bài đăng';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove(), { once: true });
    card.append(img);
  }

  const stats = document.createElement('div');
  stats.className = 'post-stats';
  const likeStats = document.createElement('span');
  likeStats.textContent = `♥ ${post.likeCount} lượt thích`;
  const commentStats = document.createElement('span');
  commentStats.textContent = `${post.commentCount} bình luận`;
  stats.append(likeStats, commentStats);
  card.append(stats);

  const actions = document.createElement('div');
  actions.className = 'post-actions';
  const like = document.createElement('button');
  like.className = `post-action${post.liked ? ' liked' : ''}`;
  like.dataset.likePost = post.id;
  like.innerHTML = `<span class="action-icon">${post.liked ? '♥' : '♡'}</span><span>${post.liked ? 'Đã thích' : 'Thích'}</span>`;
  const comment = document.createElement('button');
  comment.className = 'post-action';
  comment.dataset.openComments = post.id;
  comment.innerHTML = '<span class="action-icon">☷</span><span>Bình luận</span>';
  actions.append(like, comment);
  card.append(actions);
  return card;
}

async function loadFeed() {
  $('#feedList').innerHTML = '<div class="loading-state"><span class="loader"></span> Đang tải bảng tin...</div>';
  try {
    const data = await api(`/api/feed?filter=${state.filter}`);
    $('#feedList').replaceChildren();
    if (!data.posts.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = state.filter === 'following' ? 'Chưa có bài đăng từ những người bạn theo dõi. Hãy khám phá và kết nối thêm nhé!' : 'Chưa có bài đăng nào. Hãy là người đầu tiên chia sẻ điều thú vị!';
      $('#feedList').append(empty);
      return;
    }
    data.posts.forEach(post => $('#feedList').append(renderPost(post)));
  } catch (error) {
    $('#feedList').textContent = error.message;
  }
}

async function loadSuggestions() {
  try {
    const data = await api('/api/bootstrap');
    state.suggestions = data.suggestions || [];
    const list = $('#suggestionList');
    list.replaceChildren();
    const suggestions = state.suggestions.filter(user => user.id !== state.user?.id).slice(0, 4);
    if (!suggestions.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Chưa có gợi ý mới.';
      list.append(p);
      return;
    }
    suggestions.forEach(user => {
      const row = document.createElement('div');
      row.className = 'suggestion-item';
      const avatar = makeAvatar(user, 'avatar avatar-small');
      avatar.dataset.user = user.username;
      const info = document.createElement('div');
      info.className = 'suggestion-info';
      const name = document.createElement('strong');
      name.textContent = user.displayName;
      name.dataset.user = user.username;
      const handle = document.createElement('span');
      handle.textContent = `@${user.username}`;
      info.append(name, handle);
      row.append(avatar, info);
      if (state.user) {
        const follow = document.createElement('button');
        follow.className = 'follow-mini';
        follow.textContent = 'Xem';
        follow.dataset.user = user.username;
        row.append(follow);
      }
      list.append(row);
    });
  } catch { /* Suggestions are optional. */ }
}

async function loadProfile(username) {
  try {
    const data = await api(`/api/users/${encodeURIComponent(username)}`);
    state.currentProfile = data.profile;
    setView('profile');
    const profile = data.profile;
    const content = $('#profileContent');
    content.replaceChildren();
    const hero = document.createElement('section');
    hero.className = 'profile-hero';
    const cover = document.createElement('div');
    cover.className = 'profile-cover';
    const main = document.createElement('div');
    main.className = 'profile-main';
    const top = document.createElement('div');
    top.className = 'profile-main-top';
    top.append(makeAvatar(profile, 'avatar'));
    if (profile.isMine) {
      const edit = document.createElement('button');
      edit.className = 'button button-primary';
      edit.textContent = 'Chỉnh sửa hồ sơ';
      edit.addEventListener('click', openEditModal);
      top.append(edit);
    } else {
      const follow = document.createElement('button');
      follow.className = 'button button-primary';
      follow.textContent = profile.isFollowing ? 'Đang theo dõi' : '＋ Theo dõi';
      follow.addEventListener('click', () => toggleFollow(profile.id, follow, profile.username));
      top.append(follow);
    }
    const title = document.createElement('h2');
    title.textContent = profile.displayName;
    const usernameLine = document.createElement('div');
    usernameLine.className = 'profile-username';
    usernameLine.textContent = `@${profile.username}`;
    const bio = document.createElement('p');
    bio.className = 'profile-bio';
    bio.textContent = profile.bio || 'Người dùng này chưa thêm tiểu sử.';
    const stats = document.createElement('div');
    stats.className = 'profile-stat-row';
    stats.innerHTML = `<span><strong>${profile.postsCount}</strong> bài viết</span><span><strong id="profileFollowers">${profile.followers}</strong> người theo dõi</span><span><strong>${profile.following}</strong> đang theo dõi</span>`;
    main.append(top, title, usernameLine, bio, stats);
    hero.append(cover, main);
    const heading = document.createElement('h3');
    heading.className = 'profile-post-heading';
    heading.textContent = 'Bài viết';
    const list = document.createElement('div');
    list.className = 'feed-list';
    if (data.posts.length) data.posts.forEach(post => list.append(renderPost(post)));
    else {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Chưa có bài viết nào.';
      list.append(empty);
    }
    content.append(hero, heading, list);
  } catch (error) {
    showToast(error.message);
    setView('feed');
  }
}

async function toggleFollow(userId, button, username) {
  if (!state.user) return openAuthModal();
  try {
    const data = await api(`/api/users/${userId}/follow`, { method: 'POST', body: {} });
    if (button) button.textContent = data.following ? 'Đang theo dõi' : '＋ Theo dõi';
    if ($('#profileFollowers')) $('#profileFollowers').textContent = data.followers;
    showToast(data.following ? `Bạn đang theo dõi @${username}.` : `Đã bỏ theo dõi @${username}.`);
    loadSuggestions();
    loadMyStats();
  } catch (error) { showToast(error.message); }
}

function openAuthModal(mode = 'login') {
  setAuthMode(mode);
  $('#authModal').classList.remove('hidden');
  setTimeout(() => $('#authLogin').focus(), 50);
}

function setAuthMode(mode) {
  state.authMode = mode;
  const register = mode === 'register';
  $$('.auth-switch-button').forEach(button => button.classList.toggle('active', button.dataset.authMode === mode));
  $('#authTitle').textContent = register ? 'Tạo tài khoản mới' : 'Chào mừng trở lại!';
  $('#authSubtitle').textContent = register ? 'Tạo hồ sơ và bắt đầu kết nối với cộng đồng.' : 'Đăng nhập để tiếp tục kết nối với cộng đồng.';
  $('#displayNameField').classList.toggle('hidden', !register);
  $('#emailField').classList.toggle('hidden', !register);
  $('#loginLabel').textContent = register ? 'Tên người dùng' : 'Tên người dùng hoặc email';
  $('#authLogin').placeholder = register ? 'vd: viet_hoang' : 'Nhập username hoặc email';
  $('#authLogin').autocomplete = register ? 'username' : 'username';
  $('#authPassword').autocomplete = register ? 'new-password' : 'current-password';
  $('#authSubmit').innerHTML = register ? 'Tạo tài khoản <span>→</span>' : 'Đăng nhập <span>→</span>';
  $('#authError').textContent = '';
  $('#fillDemo').style.display = register ? 'none' : '';
}

function openEditModal() {
  if (!state.user) return openAuthModal();
  $('#editDisplayName').value = state.user.displayName || '';
  $('#editBio').value = state.user.bio || '';
  $('#editAvatarUrl').value = state.user.avatarUrl || '';
  $('#editError').textContent = '';
  $('#editModal').classList.remove('hidden');
}

async function loadComments(postId) {
  state.currentCommentPost = postId;
  $('#commentsList').innerHTML = '<div class="loading-state"><span class="loader"></span> Đang tải bình luận...</div>';
  $('#commentsModal').classList.remove('hidden');
  try {
    const data = await api(`/api/posts/${postId}/comments`);
    const list = $('#commentsList');
    list.replaceChildren();
    if (!data.comments.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Chưa có bình luận. Hãy mở đầu cuộc trò chuyện nhé!';
      list.append(empty);
    }
    data.comments.forEach(comment => {
      const row = document.createElement('div');
      row.className = 'comment-row';
      row.append(makeAvatar(comment.author, 'avatar avatar-small'));
      const content = document.createElement('div');
      content.className = 'comment-content';
      const name = document.createElement('strong');
      name.textContent = `${comment.author.displayName} · ${formatTime(comment.createdAt)}`;
      const body = document.createElement('p');
      body.textContent = comment.body;
      content.append(name, body);
      row.append(content);
      if (comment.isMine) {
        const del = document.createElement('button');
        del.className = 'comment-delete';
        del.textContent = 'Xóa';
        del.dataset.deleteComment = comment.id;
        row.append(del);
      }
      list.append(row);
    });
    list.scrollTop = list.scrollHeight;
  } catch (error) { showToast(error.message); }
}

async function loadNotifications() {
  if (!state.user) return openAuthModal();
  try {
    const data = await api('/api/notifications');
    $('#notificationBadge').textContent = data.unread > 9 ? '9+' : data.unread;
    $('#notificationBadge').classList.toggle('hidden', data.unread === 0);
    $('#topNotificationDot').classList.toggle('hidden', data.unread === 0);
    const list = $('#notificationList');
    list.replaceChildren();
    if (!data.notifications.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Chưa có thông báo. Khi có người tương tác với bạn, thông báo sẽ xuất hiện ở đây.';
      list.append(empty);
    }
    const messages = { like: 'đã thích bài viết của bạn.', comment: 'đã bình luận về bài viết của bạn.', follow: 'đã bắt đầu theo dõi bạn.' };
    data.notifications.forEach(item => {
      const row = document.createElement('div');
      row.className = `notification-item${item.isRead ? '' : ' unread'}`;
      row.append(makeAvatar(item.actor, 'avatar avatar-small'));
      const copy = document.createElement('div');
      copy.className = 'notification-copy';
      const strong = document.createElement('strong');
      strong.textContent = item.actor.displayName;
      copy.append(strong, document.createTextNode(` ${messages[item.type] || 'đã tương tác với bạn.'}`));
      const time = document.createElement('time');
      time.textContent = formatTime(item.createdAt);
      copy.append(time);
      row.append(copy);
      if (!item.isRead) {
        const dot = document.createElement('span');
        dot.className = 'unread-dot';
        row.append(dot);
      }
      if (item.postId) row.addEventListener('click', () => { setView('feed'); state.filter = 'all'; loadFeed(); });
      list.append(row);
    });
  } catch (error) { showToast(error.message); }
}

async function searchUsers(term) {
  const query = term.trim();
  if (!query) return;
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
    setView('search');
    $('#searchSummary').textContent = `Kết quả phù hợp với “${query}”`;
    const list = $('#searchResults');
    list.replaceChildren();
    if (!data.users.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Không tìm thấy người dùng phù hợp.';
      list.append(empty);
    }
    data.users.forEach(user => {
      const row = document.createElement('div');
      row.className = 'person-row';
      const avatar = makeAvatar(user, 'avatar');
      avatar.dataset.user = user.username;
      const details = document.createElement('div');
      details.className = 'person-details';
      const name = document.createElement('strong');
      name.textContent = user.displayName;
      name.dataset.user = user.username;
      const bio = document.createElement('span');
      bio.textContent = `@${user.username} · ${user.bio || 'Chưa có tiểu sử'}`;
      details.append(name, bio);
      row.append(avatar, details);
      const view = document.createElement('button');
      view.className = 'follow-mini';
      view.textContent = 'Xem hồ sơ';
      view.dataset.user = user.username;
      row.append(view);
      list.append(row);
    });
  } catch (error) { showToast(error.message); }
}

async function logout() {
  try {
    const data = await api('/api/auth/logout', { method: 'POST', body: {} });
    state.user = null;
    state.csrfToken = data.csrfToken || state.csrfToken;
    updateUserUI();
    await loadFeed();
    await loadSuggestions();
    setView('feed');
    showToast('Bạn đã đăng xuất. Hẹn gặp lại!');
  } catch (error) { showToast(error.message); }
}

function closeModal(id) { $(`#${id}`).classList.add('hidden'); }

async function init() {
  try {
    const data = await api('/api/bootstrap');
    state.user = data.user;
    state.csrfToken = data.csrfToken;
    state.suggestions = data.suggestions || [];
    updateUserUI();
    await Promise.all([loadFeed(), loadSuggestions()]);
  } catch (error) {
    $('#feedList').textContent = `Không thể kết nối máy chủ: ${error.message}`;
  }
}

// Feed filters and sidebar navigation.
$$('[data-filter]').forEach(button => button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  $$('.feed-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.filter === state.filter));
  setView('feed');
  loadFeed();
}));
$$('[data-view="feed"]').forEach(button => button.addEventListener('click', () => {
  state.filter = button.dataset.filter || 'all';
  $$('.feed-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.filter === state.filter));
  setView('feed');
  loadFeed();
}));

$('#navProfile').addEventListener('click', () => state.user ? loadProfile(state.user.username) : openAuthModal());
$('#topAvatar').addEventListener('click', () => state.user ? loadProfile(state.user.username) : openAuthModal());
$('#navNotifications').addEventListener('click', () => { setView('notifications'); loadNotifications(); });
$('#topNotifications').addEventListener('click', () => { setView('notifications'); loadNotifications(); });
$('#editProfileButton').addEventListener('click', openEditModal);
$('#sidebarAccountAction').addEventListener('click', () => state.user ? logout() : openAuthModal());
$('#welcomeLogin').addEventListener('click', () => openAuthModal('register'));
$('#composerFocus').addEventListener('click', () => state.user ? $('#postBody').focus() : openAuthModal());
$('#postBody').addEventListener('focus', () => { if (!state.user) openAuthModal(); });
$('#publishPost').addEventListener('click', async () => {
  if (!state.user) return openAuthModal();
  const body = $('#postBody').value.trim();
  const imageUrl = $('#postImageUrl').value.trim();
  if (!body) return showToast('Hãy viết nội dung trước khi đăng.');
  const button = $('#publishPost');
  button.disabled = true;
  try {
    await api('/api/posts', { method: 'POST', body: { body, imageUrl } });
    $('#postBody').value = '';
    $('#postImageUrl').value = '';
    $('#postCharCount').textContent = '0/1000';
    $('#imageUrlRow').classList.add('hidden');
    await loadFeed();
    loadMyStats();
    showToast('Bài viết của bạn đã được đăng!');
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; }
});
$('#postBody').addEventListener('input', () => { $('#postCharCount').textContent = `${$('#postBody').value.length}/1000`; });
$('#addImageButton').addEventListener('click', () => $('#imageUrlRow').classList.toggle('hidden'));
$('#removeImageUrl').addEventListener('click', () => { $('#postImageUrl').value = ''; $('#imageUrlRow').classList.add('hidden'); });

// Feed actions use event delegation so newly rendered posts work automatically.
$('#feedList').addEventListener('click', async (event) => {
  const likeButton = event.target.closest('[data-like-post]');
  const commentButton = event.target.closest('[data-open-comments]');
  const deleteButton = event.target.closest('[data-delete-post]');
  const userLink = event.target.closest('[data-user]');
  if (likeButton) {
    if (!state.user) return openAuthModal();
    try { await api(`/api/posts/${likeButton.dataset.likePost}/like`, { method: 'POST', body: {} }); await loadFeed(); }
    catch (error) { showToast(error.message); }
  } else if (commentButton) {
    if (!state.user) return openAuthModal();
    loadComments(Number(commentButton.dataset.openComments));
  } else if (deleteButton) {
    if (!confirm('Bạn có chắc muốn xóa bài đăng này?')) return;
    try { await api(`/api/posts/${deleteButton.dataset.deletePost}`, { method: 'DELETE' }); await loadFeed(); loadMyStats(); showToast('Đã xóa bài đăng.'); }
    catch (error) { showToast(error.message); }
  } else if (userLink) {
    loadProfile(userLink.dataset.user);
  }
});

// Follow suggestions and profile links.
$('#suggestionList').addEventListener('click', (event) => {
  const target = event.target.closest('[data-user]');
  if (target) loadProfile(target.dataset.user);
});
$('#profileContent').addEventListener('click', async (event) => {
  const likeButton = event.target.closest('[data-like-post]');
  const commentButton = event.target.closest('[data-open-comments]');
  const deleteButton = event.target.closest('[data-delete-post]');
  if (likeButton) {
    if (!state.user) return openAuthModal();
    try { await api(`/api/posts/${likeButton.dataset.likePost}/like`, { method: 'POST', body: {} }); await loadProfile(state.currentProfile.username); }
    catch (error) { showToast(error.message); }
  } else if (commentButton) {
    if (!state.user) return openAuthModal();
    loadComments(Number(commentButton.dataset.openComments));
  } else if (deleteButton) {
    if (!confirm('Bạn có chắc muốn xóa bài đăng này?')) return;
    try { await api(`/api/posts/${deleteButton.dataset.deletePost}`, { method: 'DELETE' }); await loadProfile(state.currentProfile.username); loadMyStats(); showToast('Đã xóa bài đăng.'); }
    catch (error) { showToast(error.message); }
  }
});

// Authentication.
$$('[data-auth-mode]').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.authMode)));
$('#fillDemo').addEventListener('click', () => { $('#authLogin').value = 'demo'; $('#authPassword').value = 'Demo1234!'; });
$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const register = state.authMode === 'register';
  const body = register
    ? { username: $('#authLogin').value.trim(), email: $('#authEmail').value.trim(), displayName: $('#authDisplayName').value.trim(), password: $('#authPassword').value }
    : { login: $('#authLogin').value.trim(), password: $('#authPassword').value };
  const submit = $('#authSubmit');
  submit.disabled = true;
  $('#authError').textContent = '';
  try {
    const data = await api(register ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body });
    state.user = data.user;
    state.csrfToken = data.csrfToken;
    closeModal('authModal');
    updateUserUI();
    await Promise.all([loadFeed(), loadSuggestions()]);
    setView('feed');
    showToast(register ? 'Tài khoản của bạn đã được tạo. Chào mừng đến V-HUB!' : `Chào mừng trở lại, ${state.user.displayName}!`);
  } catch (error) { $('#authError').textContent = error.message; }
  finally { submit.disabled = false; }
});

// Profile edit.
$('#editForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/me', { method: 'PATCH', body: {
      displayName: $('#editDisplayName').value.trim(),
      bio: $('#editBio').value.trim(),
      avatarUrl: $('#editAvatarUrl').value.trim()
    }});
    state.user = data.user;
    updateUserUI();
    closeModal('editModal');
    if (state.activeView === 'profile') await loadProfile(state.user.username);
    showToast('Hồ sơ đã được cập nhật.');
  } catch (error) { $('#editError').textContent = error.message; }
});

// Comments.
$('#commentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.user) return openAuthModal();
  const body = $('#commentInput').value.trim();
  if (!body || !state.currentCommentPost) return;
  try {
    await api(`/api/posts/${state.currentCommentPost}/comments`, { method: 'POST', body: { body } });
    $('#commentInput').value = '';
    await loadComments(state.currentCommentPost);
    await loadFeed();
  } catch (error) { showToast(error.message); }
});
$('#commentsList').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-delete-comment]');
  if (!button) return;
  try { await api(`/api/comments/${button.dataset.deleteComment}`, { method: 'DELETE' }); await loadComments(state.currentCommentPost); await loadFeed(); }
  catch (error) { showToast(error.message); }
});

// Notifications, search and modal controls.
$('#markAllRead').addEventListener('click', async () => {
  try { await api('/api/notifications/read', { method: 'POST', body: {} }); await loadNotifications(); }
  catch (error) { showToast(error.message); }
});
$('#searchInput').addEventListener('input', () => {
  clearTimeout(state.searchTimer);
  const term = $('#searchInput').value;
  if (!term.trim()) return;
  state.searchTimer = setTimeout(() => searchUsers(term), 300);
});
$('#searchInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') searchUsers($('#searchInput').value); });
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); $('#searchInput').focus(); }
  if (event.key === 'Escape') $$('.modal-backdrop').forEach(modal => modal.classList.add('hidden'));
});
$$('[data-close]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.close)));
$$('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.classList.add('hidden'); }));

init();
