/**
 * AP FlashPass - 応用情報技術者 午前頻出 一問一答 フラッシュツール
 * High-Performance, Ad-free, Keyboard & Touch Optimized
 */

(() => {
  'use strict';

  // =========================================================================
  // State Management
  // =========================================================================
  const state = {
    allCards: [],
    filteredCards: [],
    currentIndex: 0,
    isFlipped: false,
    flipDirection: 'q_to_t', // 'q_to_t' (説明 ➜ 用語) or 't_to_q' (用語 ➜ 説明)
    isShuffled: false,
    currentMode: 'flashcard', // 'flashcard', 'quiz', 'list'

    // Quiz State
    quiz: {
      currentIndex: 0,
      streak: 0,
      currentCard: null,
      choices: [],
      answered: false,
      score: 0,
      total: 0
    },

    // Persistent User Data (LocalStorage)
    userData: {
      mastered: new Set(),
      review: new Set(),
      bookmarked: new Set(),
      history: {},
      settings: {
        sound: true,
        autoAdvance: false
      }
    }
  };

  const STORAGE_KEY = 'ap_flashpass_userdata_v1';

  // =========================================================================
  // Web Audio Synthesizer (Instant feedback without external assets)
  // =========================================================================
  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playSound(type) {
    if (!state.userData.settings.sound) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;

      if (type === 'flip') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(420, now);
        osc.frequency.exponentialRampToValueAtTime(540, now + 0.08);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === 'correct' || type === 'master') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);
      } else if (type === 'wrong' || type === 'review') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.exponentialRampToValueAtTime(180, now + 0.16);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.16);
      } else if (type === 'click') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc.start(now);
        osc.stop(now + 0.04);
      }
    } catch (e) {
      // Audio autoplay policy fallback
    }
  }

  // =========================================================================
  // Storage Handling
  // =========================================================================
  function loadUserData() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        state.userData.mastered = new Set(parsed.mastered || []);
        state.userData.review = new Set(parsed.review || []);
        state.userData.bookmarked = new Set(parsed.bookmarked || []);
        state.userData.history = parsed.history || {};
        if (parsed.settings) {
          state.userData.settings = { ...state.userData.settings, ...parsed.settings };
        }
      }
    } catch (e) {
      console.warn('Failed to load user data from LocalStorage', e);
    }
  }

  function saveUserData() {
    try {
      const dataToSave = {
        mastered: Array.from(state.userData.mastered),
        review: Array.from(state.userData.review),
        bookmarked: Array.from(state.userData.bookmarked),
        history: state.userData.history,
        settings: state.userData.settings
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
      updateStats();
    } catch (e) {
      console.warn('Failed to save user data', e);
    }
  }

  // =========================================================================
  // Data Loading & Merging
  // =========================================================================
  async function initData() {
    let loadedCards = [];

    // Attempt to fetch technology.json and management_strategy.json
    try {
      const [techRes, mgmtRes] = await Promise.allSettled([
        fetch('data/technology.json').then(r => r.ok ? r.json() : []),
        fetch('data/management_strategy.json').then(r => r.ok ? r.json() : [])
      ]);

      const techData = techRes.status === 'fulfilled' ? techRes.value : [];
      const mgmtData = mgmtRes.status === 'fulfilled' ? mgmtRes.value : [];

      loadedCards = [...techData, ...mgmtData];
    } catch (e) {
      console.log('Fetch error or file:// protocol, checking embedded data');
    }

    // Fallback to embedded default dataset if fetch returned empty
    if (!loadedCards.length && window.DEFAULT_DATA && Array.isArray(window.DEFAULT_DATA)) {
      loadedCards = window.DEFAULT_DATA;
    }

    // Ensure uniqueness by ID
    const cardMap = new Map();
    loadedCards.forEach(c => {
      if (c && c.id && c.term) {
        cardMap.set(c.id, c);
      }
    });

    state.allCards = Array.from(cardMap.values());
    console.log(`Loaded ${state.allCards.length} AP FlashCards successfully.`);

    populateFilterOptions();
    applyFilter();
    setupEventListeners();
    updateStats();
  }

  // =========================================================================
  // Filter & Subcategory Setup
  // =========================================================================
  function populateFilterOptions() {
    const subcatSelect = document.getElementById('subcategory-filter');
    const subcategories = new Set();
    state.allCards.forEach(c => {
      if (c.subCategory) subcategories.add(c.subCategory);
    });

    subcatSelect.innerHTML = '<option value="all">詳細分野: すべて</option>';
    Array.from(subcategories).sort().forEach(sub => {
      const opt = document.createElement('option');
      opt.value = sub;
      opt.textContent = sub;
      subcatSelect.appendChild(opt);
    });
  }

  function applyFilter() {
    const catVal = document.getElementById('category-filter').value;
    const subcatVal = document.getElementById('subcategory-filter').value;
    const statusVal = document.getElementById('status-filter').value;

    let result = state.allCards.filter(card => {
      if (catVal !== 'all' && card.category !== catVal) return false;
      if (subcatVal !== 'all' && card.subCategory !== subcatVal) return false;
      
      const isMastered = state.userData.mastered.has(card.id);
      const isReview = state.userData.review.has(card.id);
      const isBookmarked = state.userData.bookmarked.has(card.id);

      if (statusVal === 'mastered' && !isMastered) return false;
      if (statusVal === 'review' && !isReview) return false;
      if (statusVal === 'unlearned' && (isMastered || isReview)) return false;
      if (statusVal === 'bookmarked' && !isBookmarked) return false;

      return true;
    });

    if (state.isShuffled) {
      result = shuffleArray([...result]);
    }

    state.filteredCards = result;
    state.currentIndex = 0;
    state.isFlipped = false;

    renderCurrentCard();
    renderListView();
    if (state.currentMode === 'quiz') {
      startQuizSession();
    }
  }

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // =========================================================================
  // 1. Flashcard Mode Rendering & Logic
  // =========================================================================
  function renderCurrentCard() {
    const cardEl = document.getElementById('flashcard');
    const counterEl = document.getElementById('progress-counter');
    const progressBar = document.getElementById('progress-bar');

    if (!state.filteredCards.length) {
      // Empty state
      counterEl.textContent = '0 / 0';
      progressBar.style.width = '0%';
      document.getElementById('front-main-text').textContent = '該当するカードがありません。フィルター条件を変更してください。';
      document.getElementById('front-category').textContent = 'なし';
      document.getElementById('front-difficulty').textContent = '-';
      document.getElementById('front-bookmark').classList.remove('active');
      cardEl.classList.remove('is-flipped');
      state.isFlipped = false;
      return;
    }

    const card = state.filteredCards[state.currentIndex];
    const isMastered = state.userData.mastered.has(card.id);
    const isReview = state.userData.review.has(card.id);
    const isBookmarked = state.userData.bookmarked.has(card.id);

    // Progress
    const currentNum = state.currentIndex + 1;
    const totalNum = state.filteredCards.length;
    counterEl.textContent = `${currentNum} / ${totalNum}`;
    progressBar.style.width = `${(currentNum / totalNum) * 100}%`;

    // Reset flip
    state.isFlipped = false;
    cardEl.classList.remove('is-flipped');

    // Front Face
    const frontCat = `${card.category || ''} / ${card.subCategory || ''}`;
    document.getElementById('front-category').textContent = frontCat;
    document.getElementById('front-difficulty').textContent = card.difficulty || '頻出';
    
    const frontBm = document.getElementById('front-bookmark');
    frontBm.classList.toggle('active', isBookmarked);
    frontBm.dataset.id = card.id;

    // Prompt direction handling
    const promptHint = document.getElementById('front-prompt-hint');
    const mainText = document.getElementById('front-main-text');

    if (state.flipDirection === 'q_to_t') {
      promptHint.textContent = 'Q. 次の定義・説明に当てはまる用語は？';
      mainText.textContent = card.question;
      mainText.style.fontSize = card.question.length > 100 ? '1.1rem' : '1.25rem';
    } else {
      promptHint.textContent = 'Q. 次の用語の定義・午前頻出ポイントを説明せよ';
      mainText.innerHTML = `<strong>${card.term}</strong> <span style="font-size:0.9rem; color:#94a3b8; display:block; margin-top:6px;">${card.fullSpelling || ''}</span>`;
    }

    // Back Face
    document.getElementById('back-category').textContent = frontCat;
    const backStatus = document.getElementById('back-status');
    if (isMastered) {
      backStatus.textContent = '習得済み';
      backStatus.className = 'badge mastered';
    } else if (isReview) {
      backStatus.textContent = '要復習';
      backStatus.className = 'badge review';
    } else {
      backStatus.textContent = '未着手';
      backStatus.className = 'badge badge-outline';
    }

    const backBm = document.getElementById('back-bookmark');
    backBm.classList.toggle('active', isBookmarked);
    backBm.dataset.id = card.id;

    document.getElementById('back-term').textContent = card.term;
    document.getElementById('back-spelling').textContent = card.fullSpelling ? `(${card.fullSpelling})` : '';
    
    const backDefEl = document.getElementById('back-definition');
    if (backDefEl) {
      backDefEl.textContent = card.question;
      // In term->question mode, highlight the definition
      backDefEl.style.display = 'block';
    }
    
    document.getElementById('back-exam-points').textContent = card.examPoints || card.question;

    // Keywords
    const keywordsEl = document.getElementById('back-keywords');
    keywordsEl.innerHTML = '';
    if (card.keywords && Array.isArray(card.keywords)) {
      card.keywords.forEach(kw => {
        const span = document.createElement('span');
        span.className = 'keyword-tag';
        span.textContent = kw;
        keywordsEl.appendChild(span);
      });
    }
  }

  function toggleFlipCard() {
    if (!state.filteredCards.length) return;
    const cardEl = document.getElementById('flashcard');
    state.isFlipped = !state.isFlipped;
    cardEl.classList.toggle('is-flipped', state.isFlipped);
    playSound('flip');
  }

  function handleMarkCard(status) {
    if (!state.filteredCards.length) return;
    const card = state.filteredCards[state.currentIndex];
    
    if (status === 'master') {
      state.userData.mastered.add(card.id);
      state.userData.review.delete(card.id);
      playSound('master');
    } else if (status === 'review') {
      state.userData.review.add(card.id);
      state.userData.mastered.delete(card.id);
      playSound('review');
    }

    saveUserData();

    // Advance to next card smoothly
    navigateCard(1);
  }

  function toggleBookmark(cardId) {
    if (!cardId && state.filteredCards.length) {
      cardId = state.filteredCards[state.currentIndex].id;
    }
    if (!cardId) return;

    if (state.userData.bookmarked.has(cardId)) {
      state.userData.bookmarked.delete(cardId);
    } else {
      state.userData.bookmarked.add(cardId);
      playSound('click');
    }
    saveUserData();
    renderCurrentCard();
    renderListView();
  }

  function navigateCard(direction) {
    if (!state.filteredCards.length) return;
    state.currentIndex += direction;
    if (state.currentIndex >= state.filteredCards.length) {
      state.currentIndex = 0; // Loop or finish
    } else if (state.currentIndex < 0) {
      state.currentIndex = state.filteredCards.length - 1;
    }
    renderCurrentCard();
  }

  // =========================================================================
  // 2. 4-Choice Speed Quiz Mode
  // =========================================================================
  function startQuizSession() {
    state.quiz.currentIndex = 0;
    state.quiz.streak = 0;
    state.quiz.score = 0;
    state.quiz.total = 0;
    renderQuizQuestion();
  }

  function renderQuizQuestion() {
    if (!state.filteredCards.length) return;

    // Pick card (either sequential or random from filtered list)
    const card = state.filteredCards[Math.floor(Math.random() * state.filteredCards.length)];
    state.quiz.currentCard = card;
    state.quiz.answered = false;

    document.getElementById('quiz-category-badge').textContent = `${card.category || ''} / ${card.subCategory || ''}`;
    document.getElementById('quiz-streak').textContent = `連続正解: ${state.quiz.streak}問`;
    document.getElementById('quiz-progress-text').textContent = `正解数: ${state.quiz.score} / ${state.quiz.total}`;
    document.getElementById('quiz-question-text').textContent = card.question;

    // Generate 3 plausible distractors
    const distractors = sampleDistractors(card, 3);
    const choices = shuffleArray([card, ...distractors]);
    state.quiz.choices = choices;

    const choicesContainer = document.getElementById('quiz-choices');
    choicesContainer.innerHTML = '';

    const feedbackBox = document.getElementById('quiz-feedback-box');
    feedbackBox.classList.add('hidden');

    choices.forEach((c, idx) => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.dataset.index = idx;
      btn.innerHTML = `
        <span class="choice-index">${idx + 1}</span>
        <span class="choice-term">${c.term}</span>
      `;
      btn.addEventListener('click', () => handleQuizChoice(idx));
      choicesContainer.appendChild(btn);
    });
  }

  function sampleDistractors(targetCard, count) {
    // Prefer cards in the same category or subcategory
    let pool = state.allCards.filter(c => c.id !== targetCard.id && c.term !== targetCard.term);
    const sameSub = pool.filter(c => c.subCategory === targetCard.subCategory);
    
    let chosen = [];
    if (sameSub.length >= count) {
      chosen = shuffleArray([...sameSub]).slice(0, count);
    } else {
      chosen = [...sameSub];
      const rest = pool.filter(c => !sameSub.includes(c));
      chosen = [...chosen, ...shuffleArray(rest).slice(0, count - chosen.length)];
    }
    return chosen;
  }

  function handleQuizChoice(chosenIdx) {
    if (state.quiz.answered) return;
    state.quiz.answered = true;
    state.quiz.total++;

    const chosenCard = state.quiz.choices[chosenIdx];
    const isCorrect = chosenCard.id === state.quiz.currentCard.id;

    const choiceBtns = document.querySelectorAll('.choice-btn');
    choiceBtns.forEach((btn, idx) => {
      btn.disabled = true;
      const c = state.quiz.choices[idx];
      if (c.id === state.quiz.currentCard.id) {
        btn.classList.add('correct');
      } else if (idx === chosenIdx && !isCorrect) {
        btn.classList.add('wrong');
      }
    });

    // Feedback
    const feedbackBox = document.getElementById('quiz-feedback-box');
    const resultEl = document.getElementById('quiz-feedback-result');
    const termEl = document.getElementById('quiz-feedback-term');
    const spellingEl = document.getElementById('quiz-feedback-spelling');
    const explanationEl = document.getElementById('quiz-feedback-explanation');

    feedbackBox.classList.remove('hidden');
    termEl.textContent = state.quiz.currentCard.term;
    spellingEl.textContent = state.quiz.currentCard.fullSpelling ? `(${state.quiz.currentCard.fullSpelling})` : '';
    explanationEl.textContent = state.quiz.currentCard.examPoints || state.quiz.currentCard.question;

    if (isCorrect) {
      playSound('correct');
      state.quiz.streak++;
      state.quiz.score++;
      resultEl.className = 'quiz-result-header ' + (isCorrect ? 'correct' : 'wrong');
      resultEl.innerHTML = '<span class="result-label">' + (isCorrect ? '正解' : '不正解') + '</span>';
      
      // Auto register to mastered if streak high or marked
      state.userData.mastered.add(state.quiz.currentCard.id);
      saveUserData();

      if (state.userData.settings.autoAdvance) {
        setTimeout(() => {
          if (state.currentMode === 'quiz') renderQuizQuestion();
        }, 1300);
      }
    } else {
      playSound('wrong');
      state.quiz.streak = 0;
      resultEl.className = 'quiz-result-header ' + (isCorrect ? 'correct' : 'wrong');
      resultEl.innerHTML = '<span class="result-label">' + (isCorrect ? '正解' : '不正解') + '</span>';

      // Register to review set
      state.userData.review.add(state.quiz.currentCard.id);
      state.userData.mastered.delete(state.quiz.currentCard.id);
      saveUserData();
    }

    document.getElementById('quiz-streak').textContent = `連続正解: ${state.quiz.streak}問`;
    document.getElementById('quiz-progress-text').textContent = `正解数: ${state.quiz.score} / ${state.quiz.total}`;
  }

  // =========================================================================
  // 3. Word List Table View
  // =========================================================================
  function renderListView() {
    const tableBody = document.getElementById('terms-table-body');
    const searchVal = (document.getElementById('list-search-input').value || '').toLowerCase().trim();

    let list = state.filteredCards;
    if (searchVal) {
      list = list.filter(c => 
        (c.term && c.term.toLowerCase().includes(searchVal)) ||
        (c.fullSpelling && c.fullSpelling.toLowerCase().includes(searchVal)) ||
        (c.question && c.question.toLowerCase().includes(searchVal)) ||
        (c.examPoints && c.examPoints.toLowerCase().includes(searchVal)) ||
        (c.keywords && c.keywords.some(k => k.toLowerCase().includes(searchVal)))
      );
    }

    document.getElementById('list-summary').textContent = `表示中: ${list.length} 件 / 全 ${state.allCards.length} 件`;
    tableBody.innerHTML = '';

    list.forEach(card => {
      const isMastered = state.userData.mastered.has(card.id);
      const isReview = state.userData.review.has(card.id);
      const isBookmarked = state.userData.bookmarked.has(card.id);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <button class="bookmark-icon ${isBookmarked ? 'active' : ''}" data-bm-id="${card.id}" aria-label="ブックマーク">★</button>
        </td>
        <td>
          <span class="badge ${isMastered ? 'mastered' : isReview ? 'review' : 'badge-outline'}">
            ${isMastered ? '習得' : isReview ? '復習' : '未着手'}
          </span>
        </td>
        <td><span style="font-size:0.75rem; color:var(--text-low);">${card.subCategory || card.category}</span></td>
        <td class="td-term">${card.term}</td>
        <td class="td-spelling">${card.fullSpelling || '-'}</td>
        <td class="td-point">${card.examPoints || card.question}</td>
      `;

      tr.querySelector('.bookmark-icon').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleBookmark(card.id);
      });

      // Click to open in flashcard mode
      tr.addEventListener('click', () => {
        const foundIdx = state.filteredCards.findIndex(c => c.id === card.id);
        if (foundIdx !== -1) {
          state.currentIndex = foundIdx;
          switchMode('flashcard');
          renderCurrentCard();
        }
      });

      tableBody.appendChild(tr);
    });
  }

  // =========================================================================
  // Stats Dashboard Calculation
  // =========================================================================
  function updateStats() {
    const total = state.allCards.length;
    const mastered = state.userData.mastered.size;
    const review = state.userData.review.size;
    const rate = total > 0 ? Math.round((mastered / total) * 100) : 0;

    document.getElementById('stat-total-cards').textContent = total;
    document.getElementById('stat-mastered-cards').textContent = mastered;
    document.getElementById('stat-review-cards').textContent = review;
    document.getElementById('stat-mastery-rate').textContent = `${rate}%`;

    // Category Breakdown
    const breakdownEl = document.getElementById('category-breakdown');
    if (!breakdownEl) return;
    breakdownEl.innerHTML = '';

    const categories = ['テクノロジ系', 'マネジメント系', 'ストラテジ系'];
    categories.forEach(cat => {
      const catCards = state.allCards.filter(c => c.category === cat);
      if (!catCards.length) return;
      const catMastered = catCards.filter(c => state.userData.mastered.has(c.id)).length;
      const catPercent = Math.round((catMastered / catCards.length) * 100);

      const div = document.createElement('div');
      div.className = 'cat-bar-item';
      div.innerHTML = `
        <div class="cat-bar-header">
          <span>${cat} (${catMastered} / ${catCards.length})</span>
          <span>${catPercent}%</span>
        </div>
        <div class="cat-bar-track">
          <div class="cat-bar-fill" style="width: ${catPercent}%;"></div>
        </div>
      `;
      breakdownEl.appendChild(div);
    });
  }

  // =========================================================================
  // Mode Switcher
  // =========================================================================
  function switchMode(newMode) {
    state.currentMode = newMode;
    document.querySelectorAll('.segment-btn, .tab-btn').forEach(btn => {
      const isActive = btn.dataset.mode === newMode;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    document.querySelectorAll('.view-panel, .view-section').forEach(sec => {
      sec.classList.remove('active');
    });

    const activeSec = document.getElementById(`view-${newMode}`);
    if (activeSec) activeSec.classList.add('active');

    if (newMode === 'flashcard') {
      renderCurrentCard();
    } else if (newMode === 'quiz') {
      startQuizSession();
    } else if (newMode === 'list') {
      renderListView();
    }
  }

  // =========================================================================
  // Event Listeners (Keyboard, Touch & Buttons)
  // =========================================================================
  function setupEventListeners() {
    // Mode navigation tabs
    document.querySelectorAll('.segment-btn, .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchMode(btn.dataset.mode));
    });

    // Filters
    document.getElementById('category-filter').addEventListener('change', (e) => {
      const val = e.target.value;
      const subcatSelect = document.getElementById('subcategory-filter');
      const subcategories = new Set();
      state.allCards.forEach(c => {
        if (val === 'all' || c.category === val) {
          if (c.subCategory) subcategories.add(c.subCategory);
        }
      });
      subcatSelect.innerHTML = '<option value="all">詳細分野: すべて</option>';
      Array.from(subcategories).sort().forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub;
        opt.textContent = sub;
        subcatSelect.appendChild(opt);
      });
      applyFilter();
    });

    document.getElementById('subcategory-filter').addEventListener('change', applyFilter);
    document.getElementById('status-filter').addEventListener('change', applyFilter);

    // Shuffle & Direction
    document.getElementById('btn-shuffle').addEventListener('click', () => {
      state.isShuffled = !state.isShuffled;
      const btn = document.getElementById('btn-shuffle');
      btn.classList.toggle('active', state.isShuffled);
      applyFilter();
      playSound('click');
    });

    document.getElementById('btn-flip-direction').addEventListener('click', () => {
      state.flipDirection = state.flipDirection === 'q_to_t' ? 't_to_q' : 'q_to_t';
      document.getElementById('flip-direction-label').textContent = 
        state.flipDirection === 'q_to_t' ? '説明 ➜ 用語' : '用語 ➜ 説明';
      renderCurrentCard();
      playSound('click');
    });

    // Flashcard Scene Click
    document.getElementById('card-scene').addEventListener('click', (e) => {
      if (e.target.closest('.bookmark-btn, .bookmark-icon')) return;
      toggleFlipCard();
    });

    // Action bar buttons
    document.getElementById('btn-flip').addEventListener('click', toggleFlipCard);
    document.getElementById('btn-prev').addEventListener('click', () => navigateCard(-1));
    document.getElementById('btn-next').addEventListener('click', () => navigateCard(1));
    document.getElementById('btn-review').addEventListener('click', () => handleMarkCard('review'));
    document.getElementById('btn-master').addEventListener('click', () => handleMarkCard('master'));

    // Bookmark buttons on card
    document.getElementById('front-bookmark').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBookmark();
    });
    document.getElementById('back-bookmark').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBookmark();
    });

    // Quiz next button
    document.getElementById('btn-quiz-next').addEventListener('click', renderQuizQuestion);

    // List Search
    document.getElementById('list-search-input').addEventListener('input', renderListView);

    // Modals
    document.getElementById('btn-stats-modal').addEventListener('click', () => {
      updateStats();
      document.getElementById('modal-stats').classList.remove('hidden');
    });
    document.getElementById('btn-settings-modal').addEventListener('click', () => {
      document.getElementById('modal-settings').classList.remove('hidden');
    });

    document.querySelectorAll('.modal-close-btn, .dialog-close').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById(btn.dataset.close).classList.add('hidden');
      });
    });

    // Close modal on background click
    document.querySelectorAll('.modal-overlay, .dialog-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
      });
    });

    // Settings
    const soundToggle = document.getElementById('setting-sound');
    soundToggle.checked = state.userData.settings.sound;
    soundToggle.addEventListener('change', (e) => {
      state.userData.settings.sound = e.target.checked;
      saveUserData();
    });

    const autoAdvToggle = document.getElementById('setting-auto-advance');
    autoAdvToggle.checked = state.userData.settings.autoAdvance;
    autoAdvToggle.addEventListener('change', (e) => {
      state.userData.settings.autoAdvance = e.target.checked;
      saveUserData();
    });

    // Reset Progress
    document.getElementById('btn-reset-stats').addEventListener('click', () => {
      if (confirm('すべての学習履歴（覚えた/要復習/ブックマーク）をリセットしますか？')) {
        state.userData.mastered.clear();
        state.userData.review.clear();
        state.userData.bookmarked.clear();
        saveUserData();
        applyFilter();
        alert('学習履歴を初期化しました。');
      }
    });

    // Export Data
    document.getElementById('btn-export-data').addEventListener('click', () => {
      const dump = {
        exportDate: new Date().toISOString(),
        userData: {
          mastered: Array.from(state.userData.mastered),
          review: Array.from(state.userData.review),
          bookmarked: Array.from(state.userData.bookmarked)
        }
      };
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ap_flashpass_backup_${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // Import Data
    const importInput = document.getElementById('file-import-input');
    document.getElementById('btn-import-trigger').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          if (parsed.userData) {
            if (parsed.userData.mastered) state.userData.mastered = new Set(parsed.userData.mastered);
            if (parsed.userData.review) state.userData.review = new Set(parsed.userData.review);
            if (parsed.userData.bookmarked) state.userData.bookmarked = new Set(parsed.userData.bookmarked);
            saveUserData();
            applyFilter();
            alert('データを正常に復元しました！');
          }
        } catch (err) {
          alert('JSONファイルの読み込みに失敗しました。');
        }
      };
      reader.readAsText(file);
    });

    // Keyboard Shortcuts (Blazing fast review)
    window.addEventListener('keydown', handleKeyNavigation);
  }

  function handleKeyNavigation(e) {
    // If typing in input, ignore global shortcuts
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    if (state.currentMode === 'flashcard') {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        toggleFlipCard();
      } else if (e.key === '1') {
        e.preventDefault();
        handleMarkCard('review');
      } else if (e.key === '2') {
        e.preventDefault();
        handleMarkCard('master');
      } else if (e.key === 'ArrowLeft' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        navigateCard(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        navigateCard(1);
      } else if (e.key === 'b' || e.key === 'B' || e.key === '3') {
        e.preventDefault();
        toggleBookmark();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        document.getElementById('btn-flip-direction').click();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        document.getElementById('btn-shuffle').click();
      }
    } else if (state.currentMode === 'quiz') {
      if (['1', '2', '3', '4'].includes(e.key)) {
        const choiceIdx = parseInt(e.key, 10) - 1;
        if (!state.quiz.answered) {
          handleQuizChoice(choiceIdx);
        }
      } else if ((e.code === 'Space' || e.code === 'Enter') && state.quiz.answered) {
        e.preventDefault();
        renderQuizQuestion();
      }
    }
  }

  // =========================================================================
  // Initialize App
  // =========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    loadUserData();
    initData();
  });

})();
