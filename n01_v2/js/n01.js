/*
 * n01.js
 *
 * Copyright (C) 1996-2017 by Ohno Tomoaki. All rights reserved.
 */

// 画面制御
/*globals n01_data n01_util n01_com*/
/*eslint-env jquery, browser*/
var resources = {
	en : {
		middle_p1win : "Player 1 Win",
		middle_p2win : "Player 2 Win",

		draw_msg : "This game is a draw.",
		previous_leg_confirm: "Return to the Previous Leg.",
		game_shot_msg_prefix : "Game shot ",
		game_shot_msg_suffix : " dart",
		game_shot_msg_darts : " darts",
	},
	ja : {
		menu_remaining_score : "残りスコアで入力",
		menu_exchange_scores : "スコアの入れ替え",
		menu_previous_leg : "前のレッグに戻る",
		menu_end_leg : "レッグの終了",
		menu_option : "オプション",
		menu_cancel : "キャンセル",

		menu_new : "New",
		menu_finish : "Finish",
		menu_stats : "Stats",
		key_enter : "Enter",

		finish_first : "1本目で終了",
		finish_second : "2本目で終了",
		finish_third : "3本目で終了",
		finish_cancel : "キャンセル",

		middle_p1win : "Player 1 Win",
		middle_p2win : "Player 2 Win",
		middle_draw : "引き分け",
		middle_cancel : "キャンセル",

		msg_ok : "OK",
		msg_cancel : "キャンセル",

		draw_msg : "引き分け",
		previous_leg_confirm: "前のレッグに戻りますか？",
		game_shot_msg_prefix : "",
		game_shot_msg_suffix : "本目で終了",
		game_shot_msg_darts : " ダーツ",
	},
};
var res = {};
$(document).ready(function() {
	var lang = 'en';
	if (navigator.browserLanguage) {
	    lang = navigator.browserLanguage;
	} else if (navigator.language) {
	    lang = navigator.language;
	}
	if (lang.length > 2) {
		lang = lang.substr(0, 2);
	}
	res = resources[lang];
	if (res === undefined) {
		res = resources['en'];
	} else if (lang !== 'en') {
		$('#menu_remaining_score').text(res.menu_remaining_score);
		$('#menu_exchange_scores').text(res.menu_exchange_scores);
		$('#menu_previous_leg').text(res.menu_previous_leg);
		$('#menu_end_leg').text(res.menu_end_leg);
		$('#menu_option').text(res.menu_option);
		$('#menu_cancel').text(res.menu_cancel);

		$('#menu_new').text(res.menu_new);
		$('#menu_finish').text(res.menu_finish);
		$('#menu_stats').text(res.menu_stats);
		$('#key_enter').text(res.key_enter);

		$('#finish_first').text(res.finish_first);
		$('#finish_second').text(res.finish_second);
		$('#finish_third').text(res.finish_third);
		$('#finish_cancel').text(res.finish_cancel);

		$('#middle_p1win').text(res.middle_p1win);
		$('#middle_p2win').text(res.middle_p2win);
		$('#middle_draw').text(res.middle_draw);
		$('#middle_cancel').text(res.middle_cancel);

		$('#msg_ok').text(res.msg_ok);
		$('#msg_cancel').text(res.msg_cancel);
		$('#msg_com_ok').text(res.msg_ok);
	}
});

function loaded() {
	$('#header').fadeIn('fast');
	$('#article').fadeIn('fast');
	$('#footer').fadeIn('fast');

	// 設定ロード
	n01_data.restoreOptions();
	n01_data.restoreGameOptions();
	n01_data.restoreSetData();
	if (currentLegData().selectRound === null) {
		currentLegData().selectRound = currentLegData().currentRound;
	}
	if (currentLegData().selectPlayer === null) {
		currentLegData().selectPlayer = currentLegData().currentPlayer;
	}

	// 画面の初期化
	initScore();
	showKeypad();
	if (n01_data.options.leftShow === 1) {
		$('#left_table').show();
	}

	if (n01_data.options.inputLeft === 1) {
		// 残りスコア入力モードはヘッダの色を緑にする
		$('#header').css('background-color', '#005000');
	} else if (n01_data.options.inputLeft === 0 && n01_data.setData.leftMode === 1) {
		// オプションから残りスコア入力モードが解除された場合は残りスコア入力中をキャンセルする
		n01_data.setData.leftMode = 0;
		n01_data.setData.leftModeError = 0;
		changeSelectInput(currentLegData().selectRound, currentLegData().selectPlayer);
		if (nextScore()) {
			changeNextSelect();
		}
	}
}

$(function () {
	var timer = false;
	$(window).resize(function() {
		resize();
		if (timer !== false) {
			clearTimeout(timer);
		}
		timer = setTimeout(function() {
			resize();
		}, 100);
	});
});

$(function () {
	$(document).on('keydown', function(e) {
		if($('#modal-overlay')[0]) {
			return false;
		}
		if (currentLegData() === undefined || currentLegData() === null) {
			return false;
		}
		var round = currentLegData().selectRound;
		var player = currentLegData().selectPlayer;
		switch (e.keyCode) {
		case 13:	// Enter
		case 9:		// Tab
			scrollRound(currentLegData().selectRound);
			if (nextScore() === false) {
				return false;
			}
			changeNextSelect();
			return false;
		case 8:		// BS
			deleteScore();
			return false;
		case 27:	// ESC
			if (n01_data.setData.leftMode === 1) {
				n01_data.setData.leftMode = 0;
				n01_data.setData.leftModeError = 0;
				changeSelectInput(currentLegData().selectRound, currentLegData().selectPlayer);
				if (nextScore() === false) {
					return false;
				}
				changeNextSelect();
				return false;
			}
			if (currentLegData().currentRound === currentLegData().selectRound &&
				currentLegData().currentPlayer === currentLegData().selectPlayer) {
				scrollRound(currentLegData().selectRound);
				return false;
			}
			if (currentLegData().playerData[currentLegData().selectPlayer][currentLegData().selectRound + 1] !== undefined) {
				setCurrentScore(currentLegData().playerData[currentLegData().selectPlayer][currentLegData().selectRound + 1].score);
			}
			changeSelectInput(currentLegData().currentRound, currentLegData().currentPlayer);
			return false;
		case 37:	// ←
			if (currentLegData().selectPlayer === 0 || nextScore() === false) {
				scrollRound(currentLegData().selectRound);
				return false;
			}
			changeSelectInput(round, 0);
			return false;
		case 38:	// ↑
			if (round === 0) {
				scrollTop();
				return false;
			}
			if (nextScore() === false) {
				scrollRound(currentLegData().selectRound);
				return false;
			}
			changeSelectInput(round - 1, player);
			return false;
		case 39:	// →
			if (currentLegData().selectPlayer === 1 || nextScore() === false) {
				scrollRound(currentLegData().selectRound);
				return false;
			}
			changeSelectInput(round, 1);
			return false;
		case 40:	// ↓
			if (round >= currentLegData().currentRound || nextScore() === false) {
				scrollRound(currentLegData().selectRound);
				return false;
			}
			changeSelectInput(round + 1, player);
			return false;
		case 70:	// f
			if (!$('#menu_finish').prop('disabled')) {
				scrollRound(currentLegData().selectRound);
				finishMenuOpen();
			}
			return false;
		case 77:	// m
			generalMenuOpen();
			return false;
		case 78:	// n
			window.location.href = n01_data.subPagePath + 'new.html';
			return false;
		case 83:	// s
			window.location.href = n01_data.subPagePath + 'stats.html';
			return false;
		case 116:	// F5
		case 122:	// F11
			break;
		default:
			if (e.keyCode >= 48 && e.keyCode <= 48 + 9) {
				inputScore(e.keyCode - 48);
			} else if (e.keyCode >= 96 && e.keyCode <= 96 + 9) {
				inputScore(e.keyCode - 96);
			}
			return false;
		}
		return true;
	});
});

$(function() {
	$('#header_table, #score_table, #menu_table').on('click', function() {
		setFocus();
	});

	// 入力スコアクリック
	$('.score_input').on('click', function() {
		var round = parseInt($(this).attr('round'), 10);
		if (isNaN(round) || round < 0 || round > currentLegData().currentRound) {
			// 有効範囲外
			return;
		}
		var player = parseInt($(this).attr('player'), 10);
		if (isNaN(player)) {
			return;
		}
		if (currentLegData().selectRound === round && currentLegData().selectPlayer === player) {
			if (n01_data.setData.leftMode === 1) {
				if (getCurrentScore() === '') {
					n01_data.setData.leftMode = 0;
					n01_data.setData.leftModeError = 0;
					changeSelectInput(currentLegData().selectRound, currentLegData().selectPlayer);
					currentLegData().playerData[currentLegData().selectPlayer].pop();
					return;
				}
			} else {
				// 移動なし
				return;
			}
		}
		if (nextScore()) {
			changeSelectInput(round, player);
		}
	});
	// 残りスコアクリック
	$('.score_left').on('click', function() {
		var round = parseInt($(this).attr('round'), 10);
		if (isNaN(round) || round < 0 || round > currentLegData().currentRound) {
			// 有効範囲外
			return;
		}
		var player = parseInt($(this).attr('player'), 10);
		if (isNaN(player)) {
			return;
		}
		if (currentLegData().selectRound === round && currentLegData().selectPlayer === player) {
			if (n01_data.options.inputLeft === 1 && (n01_data.gameOptions.com[currentLegData().selectPlayer] === 0 || n01_data.options.inputLeftCom === 1)) {
			} else {
				// 移動なし
				return;
			}
		}
		if (nextScore()) {
			changeSelectInput(round, player);
		}
	});
});

$(function() {
	var touchstart;
	var touchend;
	if (navigator.pointerEnabled) {
		touchstart = 'pointerdown';
		touchend = 'pointerup';
	} else if (navigator.msPointerEnabled) {
		touchstart = 'MSPointerDown';
		touchend = 'MSPointerUp';
	} else if ('ontouchstart' in window) {
		if (n01_util.getUserAgent().isAndroid) {
			touchstart = 'touchstart';
			touchend = 'touchend';
		} else {
			touchstart = 'touchstart mousedown';
			touchend = 'touchend mouseup';
		}
	} else {
		touchstart = 'mousedown';
		touchend = 'mouseup';
	}

	// メニュー処理
	function menuFunc(menuId) {
		switch (menuId) {
		case 'menu_new':
			window.location.href = n01_data.subPagePath + 'new.html';
			break;
		case 'menu_finish':
			scrollRound(currentLegData().selectRound);
			finishMenuOpen();
			break;
		case 'menu_stats':
			window.location.href = n01_data.subPagePath + 'stats.html';
			break;
		case 'menu_menu':
			generalMenuOpen();
			break;
		}
	}
	var menuTouched = false;
	$('#menu_table td').on(touchstart, function(e) {
		if ($(this).prop('disabled')) {
			return false;
		}
		$(this).css('background-color', '#2955ff');
		menuTouched = true;
		return false;
	});
	$('#menu_table td').on(touchend, function(e) {
		$(this).css('background-color', '#808080');
		if (!menuTouched) {
			return false;
		}
		var menuId = this.id;
		// iOSでclickが反応しない場合の対応
		setTimeout(function() {
			if (!menuTouched) {
				return;
			}
			menuTouched = false;
			menuFunc(menuId);
		}, 500);
		return false;
	});
	$('#menu_table td').on('click', function(e) {
		if (!menuTouched) {
			return false;
		}
		menuTouched = false;
		menuFunc(this.id);
		return false;
	});

	// キーパッド処理
	var touched = false;
	var eventType = null;
	var keyTimer = false;
	$('#key_table td').on(touchstart, function(e) {
		$(this).css('background-color', '#2955ff');
		touched = true;
		return false;
	});
	$('#key_table td').on(touchend, function(e) {
		$(this).css('background-color', '#808080');

		// touchendとmouseupが連続して発生するのを抑制
		if (keyTimer !== false) {
			clearTimeout(keyTimer);
		}
		keyTimer = setTimeout(function() {
			eventType = null;
		}, 1000);
		if (eventType !== null && eventType !== e.type) {
			return false;
		}
		eventType = e.type;
		if (!touched) {
			return false;
		}
		touched = false;

		// 入力処理
		scrollRound(currentLegData().selectRound);
		var str = this.id;
		str = str.substr('key_'.length);
		if (str.length === 1) {
			inputScore(str);
		} else if (str === 'delete') {
			deleteScore();
		} else if (str === 'enter') {
			if (nextScore()) {
				changeNextSelect();
			}
		}
		return false;
	});
	$('#menu_table td,#key_table td').on('mouseout', function() {
		$(this).css('background-color', '#808080');
		menuTouched = false;
		touched = false;
	});
});

// リサイズ
var oldWidth = 0;
function resize() {
	var windowSize = ($(window).width() < $(window).height()) ? $(window).width() : $(window).height();

	// モーダルウィンドウ
	var modalWidth = windowSize * 0.9;
	$('.modal_window').css('width', modalWidth + 'px');
	var modalFont = windowSize * 0.06;
	$('.modal_window').css('font-size', modalFont + 'px');
	var menuPadding = windowSize * 0.045;
	$('.menu_ul li').css('padding', menuPadding + 'px 0px');
	var messagePadding1 = windowSize * 0.1;
	var messagePadding2 = windowSize * 0.005;
	var messagePaddingWidth = windowSize * 0.05;
	$('.message_title').css('padding', messagePadding1 + 'px ' + messagePaddingWidth + 'px ' + messagePadding2 + 'px ' + messagePaddingWidth + 'px');
	$('.message_msg').css('padding', messagePadding2 + 'px ' + messagePaddingWidth + 'px ' + messagePadding1 + 'px ' + messagePaddingWidth + 'px');

	var messageButtonPadding = windowSize * 0.045;
	$('.msg_button').css('padding', messageButtonPadding + 'px 0px');
	var messageButtonMargin = windowSize * 0.045;
	$('#msg_cancel').css('margin', '0 ' + (messageButtonMargin / 2) + 'px ' + messageButtonMargin + 'px ' + messageButtonMargin + 'px');
	$('#msg_ok').css('margin', '0 ' + messageButtonMargin + 'px ' + messageButtonMargin + 'px ' + (messageButtonMargin / 2) + 'px');
	$('#msg_com_ok').css('margin', messageButtonMargin + 'px');
	$('#msg_com_ok').css('margin-top', '0');

	var throwWidth = windowSize * 0.9;
	$('.throw_window').css('width', throwWidth + 'px');
	var throwPadding = windowSize * 0.05;
	$('.throw_div').css('padding', '0 ' + throwPadding + 'px 0 ' + throwPadding + 'px');
	var throwHeight = windowSize * 0.28;
	$('.throw').css('height', throwHeight + 'px');
	var throwFont = windowSize * 0.09;
	$('.throw').css('font-size', throwFont + 'px');

	centeringObject($("#general_menu"));
	centeringObject($("#finish_menu"));
	centeringObject($("#middle_menu"));
	centeringObject($("#popup_message"));
	centeringObject($("#com_throw"));
	centeringObject($("#popup_message_com"));

	// ヘッダー
	var headerPaddingHeight = windowSize * 0.02;
	$('#p1_name').css('padding', headerPaddingHeight + 'px 0px ' +  headerPaddingHeight + 'px ' +  headerPaddingHeight + 'px');
	$('#p2_name').css('padding', headerPaddingHeight + 'px ' +  headerPaddingHeight + 'px ' +  headerPaddingHeight + 'px 0px');
	var headerFont = windowSize * 0.065;
	$('#header_table').css('font-size', headerFont + 'px');

	$('#header').css('height', $('#header_table').height() + 'px');

	var scoreFont;
	if ($(window).width() < $(window).height()) {
		// 縦幅が長い場合はSmartphoneに最適化
		windowSize = $(window).width();
		scoreFont = windowSize * 0.085;
	} else {
		// 横幅が長い場合はPCに最適化
		windowSize = $(window).width() * 0.75;
		scoreFont = windowSize * 0.09;
	}
	
	// スコア一覧
	var scoreHeaderHeight = windowSize * 0.06;
	var scoreHeaderFont = windowSize * 0.045;
	$('.score_table th').css('height', scoreHeaderHeight + 'px');
	$('.score_table th').css('font-size', scoreHeaderFont + 'px');

	var scoreHeight = windowSize * 0.138;
	$('.score_table td').css('height', scoreHeight + 'px');
	$('.score_table td').css('font-size', scoreFont + 'px');
	$('.hidden_table td').css('height', scoreHeight + 'px');
	$('.hidden_table td').css('font-size', scoreFont + 'px');
	$('.input_text_score').css('font-size', scoreFont + 'px');

	var border = Math.floor(windowSize * 0.0015);
	if (border < 1) {
		border = 1;
	}
	$('.score_table th').css('border', border + 'px solid #555555');
	$('.score_table td').css('border', border + 'px solid #555555');
	$('.hidden_table td').css('border', border + 'px solid #555555');
	$('.score_table th:first-child, .score_table td:first-child, .hidden_table td:first-child').css('border-left', '0px');
	$('.score_table th:last-child, .score_table td:last-child, .hidden_table td:last-child').css('border-right', '0px');
	$('.msg_button').css('border', border + 'px solid #006cff');
	
	$('#footer').css('border-top', border + 'px solid #000');

	resizeCircleTon(windowSize);

	windowSize = ($(window).width() < $(window).height()) ? $(window).width() : $(window).height();
	// フッター
	$('#key_table td').css('border', border + 'px solid #3b3b3b');
	$('#key_table td:first-child').css('border-left', '0px');
	$('#key_table td:last-child').css('border-right', '0px');
	$('#key_table tr:last-child td').css('border-bottom', '0px');
	if (n01_data.options.leftShow === 1) {
		var leftWindowSize = ($(window).width() < $(window).height() * 1.1) ? $(window).width() : $(window).height() * 1.1;
		var leftFont = leftWindowSize * 0.21;
		$('#left_table td').css('font-size', leftFont + 'px');
		var leftPadding = leftWindowSize * 0.005;
		$('#p1left_big').css('padding', leftPadding + 'px 0');
		$('#p2left_big').css('padding', leftPadding + 'px 0');
		var leftFocusSize = windowSize * 0.017;
		$('#p1left_big').css('margin', leftFocusSize + 'px');
		$('#p2left_big').css('margin', leftFocusSize + 'px');

		$('#footer').css('border-top', (border * 2) + 'px solid #000');
		$('#menu_table td').css('border-top', border + 'px solid #3b3b3b');
	}

	if ($(window).width() / $(window).height() >= 0.8 || n01_data.options.smallKeypad === 1) {
		windowSize = windowSize / 1.5;
	}
	var menuHeight = windowSize * 0.1;
	var menuFont = windowSize * 0.05;
	$('#menu_table td').css('height', menuHeight + 'px');
	$('#menu_table td').css('font-size', menuFont + 'px');

	var imgMenuHeight = windowSize * 0.03;
	var imgMenuWidth = imgMenuHeight * 2;
	$('#img_menuButton').css('height', imgMenuHeight + 'px');
	$('#img_menuButton').css('width', imgMenuWidth + 'px');

	// 数字キー
	var keyHeight = windowSize * 0.15;
	var keyFont = windowSize * 0.09;
	$('#key_table td').css('height', keyHeight + 'px');
	$('#key_table').css('font-size', keyFont + 'px');
	var enterFont = windowSize * 0.06;
	$('#key_enter').css('font-size', enterFont + 'px');

	var imgDeleteHeight = windowSize * 0.058;
	var imgDeleteWidth = imgDeleteHeight * (230 / 140);
	$('#img_delete').css('height', imgDeleteHeight + 'px');
	$('#img_delete').css('width', imgDeleteWidth + 'px');

	// 数字キーの表示、非表示によるスクロール範囲の設定
	var footerHeight = $('#menu_table').height();
	if (n01_data.options.leftShow === 1) {
		footerHeight += $('#left_table').height();
	}
	if (n01_data.options.keyShow === 1) {
		footerHeight += $('#key_table').height();
	}
	if (n01_data.options.inputTag === 1 && n01_util.getUserAgent().isiOS) {
		//footerHeight += 44;
	}
	$('#footer').css('height', footerHeight + 'px');
	$('#article').css('height', ($(window).height() - $('#header').outerHeight(true) - $('#footer').outerHeight(true)) + 'px');
	$('#article').css('margin-top', $('#header').outerHeight(true) + 'px');

	if (oldWidth !== $(window).width()) {
		oldWidth = $(window).width();
		if (currentLegData() !== undefined && currentLegData() !== null) {
			setTimeout(function() {
				scrollTop();
				scrollRound(currentLegData().selectRound);
			} ,100);
		}
	}
}

function resizeCircleTon(windowSize) {
	if (n01_data.options.circleTon !== 1) {
		return;
	}
	var tonWidth = getScoreObj(0, 0).width() * 4;
	var tonHeight = getScoreObj(0, 0).height() * 4;
	if (tonWidth === 0 || tonHeight === 0) {
		return;
	}
	$('#canvas_ton').attr('width', tonWidth + 'px');
	$('#canvas_ton').attr('height', tonHeight + 'px');
	var canvas = document.getElementById('canvas_ton');
	if (!canvas || !canvas.getContext) {
		return;
	}
	var ctx = canvas.getContext('2d');
	ctx.beginPath();
	ctx.save();
	ctx.scale(tonWidth / tonHeight, 1);
	var margin = Math.floor(windowSize * 0.006);
	if (margin < 2) {
		margin = 2;
	}
	ctx.arc(tonHeight / 2, tonHeight / 2, tonHeight/ 2 - margin * 4, 0, Math.PI * 2, false);
	ctx.restore();
	ctx.strokeStyle = '#a0a0a0';
	var border = Math.floor(windowSize * 0.005);
	if (border < 2) {
		border = 2;
	}
	ctx.lineWidth = border * 4;
	ctx.stroke();
	$('.score_input').each(function(i, elem) {
		setCircleTon($(elem));
	});
}

function setCircleTon(obj) {
	if (n01_data.options.circleTon !== 1 || n01_data.setData.leftMode === 1) {
		return;
	}
	var score = parseInt(obj.text(), 10);
	if (score >= 100) {
		var canvas = document.getElementById('canvas_ton');
		if (canvas && canvas.getContext) {
			obj.css('background-image', 'url("' + canvas.toDataURL() + '")');
		}
	} else {
		obj.css('background-image', 'none');
	}
}

// センタリング
function centeringObject(obj) {
	var w = $(window).width();
	var h = $(window).height();
	var cw = obj.width();
	var ch = obj.height();
	obj.css({"left": ((w - cw) / 2) + "px", "top": ((h - ch) / 2) + "px"});
}

// キーパッドの表示切り替え
function showKeypad() {
	if (n01_data.options.keyShow === 1) {
		$('#key_table').show();
	} else {
		$('#key_table').hide();
	}
	resize();
	scrollRound(currentLegData().selectRound);
}

// 名前の表示
function showName() {
	if (currentLegData().first === 0) {
		$('#p1_name').text('* ' + n01_data.setData.statsData[0].name);
		$('#p2_name').text(n01_data.setData.statsData[1].name);
	} else {
		$('#p1_name').text(n01_data.setData.statsData[0].name);
		$('#p2_name').text('* ' + n01_data.setData.statsData[1].name);
	}
	$('#article').css('top', $('#header_table').height() + 'px');
}

// Leg数の表示
function showLegs() {
	$('#legs').text(n01_data.setData.statsData[0].winLegs + ' - ' + n01_data.setData.statsData[1].winLegs);
}

// 残りスコアの表示
function showLeft() {
	if (n01_data.options.leftShow !== 1) {
		return;
	}
	var left;
	if (currentLegData().playerData[0][currentLegData().currentRound + 1] !== undefined) {
		left = currentLegData().playerData[0][currentLegData().currentRound + 1].left;
	} else {
		left = currentLegData().playerData[0][currentLegData().currentRound].left;
	}
	$('#p1left_big').text(left);

	if (currentLegData().playerData[1][currentLegData().currentRound + 1] !== undefined) {
		left = currentLegData().playerData[1][currentLegData().currentRound + 1].left;
	} else {
		left = currentLegData().playerData[1][currentLegData().currentRound].left;
	}
	$('#p2left_big').text(left);

	showLeftCurrent();
}

function setFinishLeft() {
	if (n01_data.options.leftShow !== 1) {
		return;
	}
	if (currentLegData().currentPlayer === 0) {
		$('#p1left_big').text(0);
	} else {
		$('#p2left_big').text(0);
	}
}

function showLeftCurrent() {
	if (n01_data.options.leftShow !== 1) {
		return;
	}
	if (currentLegData().currentPlayer === 0) {
		$('#p1left_big_td').css('background-color', '#0a246a');
		$('#p2left_big_td').css('background-color', '#ffffff');
	} else {
		$('#p1left_big_td').css('background-color', '#ffffff');
		$('#p2left_big_td').css('background-color', '#0a246a');
	}
}

function scrollTop() {
	$('#article').scrollTop(0);
}

// 選択位置までスクロール
function scrollRound(round) {
	var offsetY = $('#article').height() - $('#round_' + round).height();
	var top = $('#score_table th').height() + $('#round_' + round).height() * (round + 1);
	var scrollY = $('#article').scrollTop();
	if (top <= scrollY) {
		// 上にスクロール
		$('#article').scrollTop(top);
	} else if(top >= scrollY + offsetY) {
		// 下にスクロール
		$('#article').scrollTop(top - offsetY);
	}
}

var currentInputObj;
var startInput = true;
// 選択を移動
function changeSelectInput(newRound, newPlayer) {
	if (newRound < 0 || newRound > currentLegData().currentRound) {
		return;
	}
	if (currentInputObj != undefined) {
		// 前回の入力の解除
		currentInputObj.css('background-color', '#ffffff');
		if (n01_data.options.inputTag === 1) {
			var currentScore = getCurrentScore();
			$('#input_text_score').remove();
			currentInputObj.text(currentScore);
			setCircleTon(currentInputObj);
		}
	}
	// 入力域の設定
	if (n01_data.setData.leftMode === 1) {
		currentInputObj = getLeftObj(newRound, newPlayer);
		if (n01_data.setData.leftModeError === 1) {
			// 残りスコア入力の計算間違いは背景色を赤くする
			currentInputObj.css('background-color', '#ffb0b0');
		} else {
			currentInputObj.css('background-color', '#ffff80');
		}
	} else {
		currentInputObj = getScoreObj(newRound, newPlayer);
		currentInputObj.css('background-color', '#ffff80');
	}
	if (n01_data.options.inputTag === 1) {
		// 入力域をinputタグにする(iOSでのBluetooth対応)
		var score = currentInputObj.text();
		currentInputObj.text('');
		currentInputObj.append('<input type="text" id="input_text_score" class="input_text_score" />');
		$('.input_text_score').css('font-size',  $('.score_table td').css('font-size'));
		setCurrentScore(score);
		setCircleTon(currentInputObj);
	}
	startInput = true;
	
	currentLegData().selectRound = newRound;
	currentLegData().selectPlayer = newPlayer;
	n01_data.setData.currnetInput = getCurrentScore();
	n01_data.saveSetData();
	
	scrollRound(currentLegData().selectRound);
	enableFinishButton();

	setFocus();

	if (n01_data.setData.leftMode === 0 && currentLegData().selectRound === currentLegData().currentRound &&
		currentLegData().selectPlayer === currentLegData().currentPlayer &&
		currentLegData().playerData[currentLegData().selectPlayer][currentLegData().selectRound + 1] === undefined &&
		n01_data.gameOptions.com[currentLegData().selectPlayer] === 1) {
		// COMのスローを開始
		comStart();
	}
}

function changeNextSelect() {
	if (getCurrentScore() === '') {
		return;
	}
	if (currentLegData().first === currentLegData().selectPlayer) {
		changeSelectInput(currentLegData().selectRound, (currentLegData().selectPlayer === 0) ? 1 : 0);
	} else {
		changeSelectInput(currentLegData().selectRound + 1, (currentLegData().selectPlayer === 0) ? 1 : 0);
	}
}

function setCurrentScore(score) {
	if (n01_data.options.inputTag === 1) {
		$('#input_text_score').val(score);
	} else {
		currentInputObj.text(score);
		setCircleTon(currentInputObj);
	}
}

function getCurrentScore() {
	var score;
	if (n01_data.options.inputTag === 1) {
		score = $('#input_text_score').val();
	} else {
		score = currentInputObj.text();
	}
	if (score === null) {
		score = '';
	}
	return score;
}

function setFocus() {
	if (n01_data.options.inputTag === 1) {
		$('#input_text_score').focus();
	}
}

// Finishボタンの活性／非活性
function enableFinishButton() {
	if (n01_data.gameOptions.com[currentLegData().selectPlayer] === 1) {
		$('#menu_finish').css('color', '#a0a0a0');
		$('#menu_finish').prop('disabled', true);
		return;
	}
	if (currentLegData().playerData[currentLegData().selectPlayer][currentLegData().selectRound].left <= 180) {
		$('#menu_finish').css('color', '#ffffff');
		$('#menu_finish').prop('disabled', false);
	} else {
		$('#menu_finish').css('color', '#a0a0a0');
		$('#menu_finish').prop('disabled', true);
	}
}

// スコア制御
function initScore() {
	// 初期化
	scrollTop();
	currentInputObj = undefined;
	$('#score_body').empty();

	// 開始スコアの設定
	var objStart = $('#score_list_start').clone(false).appendTo('#score_body');
	objStart.find('.p1left').text(currentLegData().playerData[0][0].left);
	objStart.find('.p2left').text(currentLegData().playerData[1][0].left);

	// ラウンドデータの生成
	var round;
	if (n01_data.gameOptions.roundLimit === 1) {
		round = n01_data.gameOptions.maxRound;
		if (round > 60) {
			// ラウンド制限の値が大きすぎる場合は初期生成を60ラウンドとする
			round = 60;
		}
	} else {
		// ラウンド制限しない場合は初期生成を15ラウンドとする
		round = 15;
	}
	if (round < currentLegData().playerData[0].length) {
		round = currentLegData().playerData[0].length;
	}
	for (var i = 0; i < round; i++) {
		var obj = addRound(i);
		if (currentLegData().playerData[0][i + 1] != undefined) {
			obj.find('.p1score').text(currentLegData().playerData[0][i + 1].score);
			obj.find('.p1left').text(currentLegData().playerData[0][i + 1].left);
			setCircleTon(obj.find('.p1score'));
		}
		if (currentLegData().playerData[1][i + 1] != undefined) {
			obj.find('.p2score').text(currentLegData().playerData[1][i + 1].score);
			obj.find('.p2left').text(currentLegData().playerData[1][i + 1].left);
			setCircleTon(obj.find('.p2score'));
		}
	}

	// 選択の移動
	var currnetInput = n01_data.setData.currnetInput;
	changeSelectInput(currentLegData().selectRound, currentLegData().selectPlayer);
	// 入力中スコアの復元
	if (currnetInput !== getCurrentScore()) {
		startInput = false;
	}
	setCurrentScore(currnetInput);
	n01_data.setData.currnetInput = currnetInput;
	n01_data.saveSetData();

	// ヘッダ情報の初期化
	showName();
	showLegs();
	showLeft();

	// サイズ調整
	resize();
	var diff = $('#p1_name').width() - $('#p2_name').width();
	if (diff > 1 || diff < -1 || $('#header_table').width() > $(window).width()) {
		// 折返し方法の変更
		$('.player_name').css('word-break', 'break-all');
		resize();
	}

	setTimeout(function() {
		// 選択位置までスクロール
		scrollRound(currentLegData().selectRound);
		setFocus();
	}, 200);
}

function addRound(round) {
	var obj = $('#score_list_score').clone(true).appendTo('#score_body');
	obj.attr('id', 'round_' + round);
	if (n01_data.options.roundDarts === 1) {
		obj.find('.score_round').text((round + 1) * 3);
	} else {
		obj.find('.score_round').text(round + 1);
	}
	obj.find('.p1score').attr('round', round);
	obj.find('.p1left').attr('round', round);
	obj.find('.p2score').attr('round', round);
	obj.find('.p2left').attr('round', round);
	return obj;
}

function inputScore(value) {
	if (n01_data.setData.leftMode === 0 && n01_data.gameOptions.com[currentLegData().selectPlayer] === 1) {
		return;
	}
	scrollRound(currentLegData().selectRound);
	var score = getCurrentScore();
	if (startInput === true || score === '') {
		score = '0';
	}
	score = parseInt(score, 10) * 10 + parseInt(value, 10);
	if (score > 999) {
		return;
	}
	setCurrentScore(score);
	startInput = false;

	n01_data.setData.currnetInput = getCurrentScore();
	n01_data.saveSetData();
}

function deleteScore() {
	if (n01_data.setData.leftMode === 0 && n01_data.gameOptions.com[currentLegData().selectPlayer] === 1) {
		return;
	}
	scrollRound(currentLegData().selectRound);
	var score = getCurrentScore();
	if (score === '') {
		return;
	}
	if (score.length === 1) {
		setCurrentScore('');
	} else {
		setCurrentScore(Math.floor(parseInt(score, 10) / 10));
	}
	startInput = false;

	n01_data.setData.currnetInput = getCurrentScore();
	n01_data.saveSetData();
}

// 残りスコアで入力
function remainingScore() {
	if (n01_data.gameOptions.com[currentLegData().selectPlayer] === 1) {
		return;
	}
	scrollRound(currentLegData().selectRound);
	var score = getCurrentScore();
	if (score === '') {
		return;
	}
	var left = currentLegData().playerData[currentLegData().selectPlayer][currentLegData().selectRound].left;
	if (left - score >= 0) {
		setCurrentScore(left - score);
		if (nextScore()) {
			changeNextSelect();
		}
	}
}

// スコアの入替え
function exchangeScores() {
	var tmpData = currentLegData().playerData[0];
	currentLegData().playerData[0] = currentLegData().playerData[1];
	currentLegData().playerData[1] = tmpData;
	
	currentLegData().first = (currentLegData().first == 0) ? 1 : 0;
	currentLegData().selectPlayer = (currentLegData().selectPlayer == 0) ? 1 : 0;
	currentLegData().currentPlayer = (currentLegData().currentPlayer == 0) ? 1 : 0;
	n01_data.saveSetData();
	
	initScore();
}

// 残りスコア入力のチェック
function checkLeft() {
	var inpuLeft = getCurrentScore();
	if (inpuLeft === '') {
		return false;
	}
	inpuLeft = parseInt(inpuLeft, 10);
	var left = currentLegData().playerData[currentLegData().selectPlayer][currentLegData().selectRound + 1].left;
	if (inpuLeft !== left) {
		// 残りスコアの計算間違い
		n01_data.setData.leftModeError = 1;
		changeSelectInput(currentLegData().selectRound, currentLegData().selectPlayer);
		return false;
	}

	n01_data.setData.leftMode = 0;
	n01_data.setData.leftModeError = 0;
	changeSelectInput(currentLegData().selectRound, currentLegData().selectPlayer);
	return nextScore();
}

// 次のスコア入力に遷移
function nextScore() {
	if (n01_data.setData.leftMode === 1) {
		return checkLeft();
	}
	// 入力チェック
	var score = getCurrentScore();
	if (n01_data.options.inputTag === 1) {
		score = score.replace(/[０-９]/g, function(s){return String.fromCharCode(s.charCodeAt(0) - 0xFEE0)});
		score = score.replace(/[^0-9]/g, '');
		setCurrentScore(score);
	}
	if (score === '') {
		if (currentLegData().selectRound === currentLegData().currentRound &&
			(currentLegData().first === currentLegData().currentPlayer || currentLegData().selectPlayer === currentLegData().currentPlayer)) {
			return true;
		}
		return false;
	}
	score = parseInt(score, 10);
	if (score > 180 || score === 179 ||
		score === 178 || score === 176 ||
		score === 175 || score === 173 ||
		score === 172 || score === 169) {
		return false;
	}

	// 開始日時設定
	if (n01_data.setData.startTime === undefined || n01_data.setData.startTime === 0) {
		n01_data.setData.startTime = new Date().getTime();
	}

	// 入力ラウンドの残りスコアを更新
	var left = currentLegData().playerData[currentLegData().selectPlayer][currentLegData().selectRound].left - score;
	if (left < 0) {
		if (startInput === true) {
			return true;
		}
		return false;
	}
	if (left === 0) {
		finishMenuOpen();
		return false;
	}
	if (currentLegData().playerData[currentLegData().selectPlayer][currentLegData().selectRound + 1] === undefined) {
		currentLegData().playerData[currentLegData().selectPlayer].push({score: score, left: left});
		if (n01_data.options.inputLeft === 1 && (n01_data.gameOptions.com[currentLegData().selectPlayer] === 0 || n01_data.options.inputLeftCom === 1)) {
			n01_data.setData.leftMode = 1;
			n01_data.setData.leftModeError = 0;
			changeSelectInput(currentLegData().selectRound, currentLegData().selectPlayer);
			return false;
		} else {
			getLeftObj(currentLegData().selectRound, currentLegData().selectPlayer).text(left);
		}
	} else {
		currentLegData().playerData[currentLegData().selectPlayer][currentLegData().selectRound + 1].score = score;
		currentLegData().playerData[currentLegData().selectPlayer][currentLegData().selectRound + 1].left = left;
		getLeftObj(currentLegData().selectRound, currentLegData().selectPlayer).text(left);
	}

	// 入力ラウンド以降の残りスコアを更新
	for (var i = currentLegData().selectRound + 1; i < currentLegData().currentRound + 1; i++) {
		if (currentLegData().playerData[currentLegData().selectPlayer][i + 1] === undefined) {
			break;
		}
		var nLeft = currentLegData().playerData[currentLegData().selectPlayer][i].left - currentLegData().playerData[currentLegData().selectPlayer][i + 1].score;
		currentLegData().playerData[currentLegData().selectPlayer][i + 1].left = nLeft;
		getLeftObj(i, currentLegData().selectPlayer).text(nLeft);
	}

	// 先攻の入れ替え
	if (currentLegData().selectRound === currentLegData().currentRound &&
		currentLegData().currentPlayer === currentLegData().first &&
		currentLegData().selectPlayer !== currentLegData().first) {
		currentLegData().first = currentLegData().selectPlayer;
		currentLegData().currentPlayer = currentLegData().selectPlayer;
		showName();
		resize();
	}

	// 選択の移動
	if (currentLegData().first === currentLegData().selectPlayer) {
		if (currentLegData().selectRound === currentLegData().currentRound &&
			currentLegData().selectPlayer === currentLegData().currentPlayer) {
			currentLegData().currentPlayer = (currentLegData().currentPlayer === 0) ? 1 : 0;
		}
	} else {
		if (currentLegData().selectRound === currentLegData().currentRound) {
			currentLegData().currentRound++;
			currentLegData().currentPlayer = currentLegData().first;
			if ($('#score_body').children().length <= currentLegData().currentRound + 1) {
				// 表示ラウンドの追加
				addRound(currentLegData().currentRound);
				setTimeout(function() {
					scrollRound(currentLegData().selectRound);
				} ,100);
			}
			if (n01_data.gameOptions.roundLimit === 1 && n01_data.gameOptions.maxRound === currentLegData().currentRound) {
				// ラウンドオーバー
				showLeft();
				if (n01_data.gameOptions.com[0] === 1 || n01_data.gameOptions.com[1] === 1) {
					comDrawMsgOpen();
				} else {
					changeSelectInput(currentLegData().selectRound + 1, (currentLegData().selectPlayer === 0) ? 1 : 0);
					middleMenuOpen();
				}
				return false;
			}
		}
	}
	showLeft();
	n01_data.saveSetData();
	return true;
}

// 次のLegに遷移
function nextLeg() {
	if (n01_data.setData.legData[n01_data.setData.currentLeg + 1] === undefined) {
		// Leg情報の追加
		n01_data.setData.legData.push($.extend(true, {}, n01_data.initLegData));
		var nextFirst = (currentLegData().first === 0) ? 1 : 0;
		n01_data.setData.currentLeg++;
		currentLegData().first = currentLegData().currentPlayer = currentLegData().selectPlayer = nextFirst;
	} else {
		// 既にあるLeg情報を利用
		n01_data.setData.currentLeg++;
	}
	// 開始スコアの設定（1leg毎にランダム生成）
	var randomScore = n01_data.generateRandomStartScore();
	if (n01_data.gameOptions.p1_handicap === 1) {
		currentLegData().playerData[0][0].left = n01_data.gameOptions.p1_handicap_score;
	} else {
		currentLegData().playerData[0][0].left = randomScore;
	}
	if (n01_data.gameOptions.p2_handicap === 1) {
		currentLegData().playerData[1][0].left = n01_data.gameOptions.p2_handicap_score;
	} else {
		currentLegData().playerData[1][0].left = randomScore;
	}
	n01_data.setData.currnetInput = '';
	n01_data.setData.leftMode = 0;
	n01_data.setData.leftModeError = 0;
	n01_data.saveSetData();

	// 表示スコアの更新
	initScore();
}

// 前のLegに戻る
function previousConfirm() {
	if (n01_data.setData.currentLeg === 0) {
		setFocus();
		return;
	}
	previousMsgOpen();
}
function previousLeg() {
	if (n01_data.setData.leftMode === 1) {
		n01_data.setData.leftMode = 0;
		n01_data.setData.leftModeError = 0;
		changeSelectInput(currentLegData().selectRound, currentLegData().selectPlayer);
		nextScore();
	}
	// 選択を末尾にする
	currentLegData().selectRound = currentLegData().currentRound;
	currentLegData().selectPlayer = currentLegData().currentPlayer;

	// 前のLegに移動
	n01_data.setData.currentLeg--;
	
	// Leg情報の更新
	currentLegData().endFlag = 0;
	currentLegData().middleForDiddle = 0;
	if (currentLegData().winner >= 0) {
		n01_data.setData.statsData[currentLegData().winner].winLegs--;
	}
	currentLegData().playerData[currentLegData().selectPlayer].splice(currentLegData().selectRound + 1);
	n01_data.setData.currnetInput = '';
	n01_data.saveSetData();

	// 表示スコアの更新
	initScore();
}

// Stasの計算
function calcStatsData(player) {
	if (currentLegData().winner === player) {
		n01_data.setData.statsData[player].winLegs++;
	}
}

// Finish
function finishConfirm(dart) {
	finishMsgOpen(currentLegData().selectPlayer, dart, (currentLegData().selectRound * 3) + dart);
}
function finish(dart) {
	// 先攻の入れ替え
	if (currentLegData().selectRound === currentLegData().currentRound &&
		currentLegData().currentPlayer === currentLegData().first &&
		currentLegData().selectPlayer !== currentLegData().first) {
		currentLegData().first = currentLegData().selectPlayer;
		currentLegData().currentPlayer = currentLegData().selectPlayer;
		showName();
	}
	// Finishラウンド以降のスコアデータを消去
	currentLegData().playerData[currentLegData().selectPlayer].splice(currentLegData().selectRound + 1);
	var deletePlayer = (currentLegData().selectPlayer === 0) ? 1 : 0;
	var deleteRound = (currentLegData().first === deletePlayer) ? currentLegData().selectRound + 2 : currentLegData().selectRound + 1;
	currentLegData().playerData[deletePlayer].splice(deleteRound);

	// Finishスコアの設定
	if (currentLegData().playerData[currentLegData().selectPlayer][currentLegData().selectRound + 1] === undefined) {
		currentLegData().playerData[currentLegData().selectPlayer].push({score: (dart * -1), left: 0});
	} else {
		currentLegData().playerData[currentLegData().selectPlayer][currentLegData().selectRound + 1].score = (dart * -1);
		currentLegData().playerData[currentLegData().selectPlayer][currentLegData().selectRound + 1].left = 0;
	}
	// Leg情報の更新
	currentLegData().currentRound = currentLegData().selectRound;
	currentLegData().currentPlayer = currentLegData().selectPlayer;
	currentLegData().endFlag = 1;
	currentLegData().middleForDiddle = 0;
	currentLegData().winner = currentLegData().selectPlayer;
	calcStatsData(currentLegData().selectPlayer);
	// 次のLegに移動
	nextLeg();
}

// ラウンドオーバー
function middleConfirm(player) {
	middleMsgOpen(player);
}
function middle(player) {
	// 終了ラウンド以降のスコアデータを消去
	currentLegData().selectPlayer = currentLegData().first;
	currentLegData().playerData[0].splice(currentLegData().selectRound + 1);
	currentLegData().playerData[1].splice(currentLegData().selectRound + 1);

	// Leg情報の更新
	currentLegData().currentRound = currentLegData().selectRound;
	currentLegData().currentPlayer = currentLegData().selectPlayer;
	currentLegData().endFlag = 1;
	currentLegData().middleForDiddle = 1;
	if (player === 0 || player === 1) {
		// 勝敗の設定
		currentLegData().winner = player;
		calcStatsData(player);
	} else {
		// 引き分け
		currentLegData().winner = -1;
	}
	// 次のLegに移動
	nextLeg();
}

// ポップアップ画面制御
function generalMenuOpen() {
	if($('#modal-overlay')[0]) {
		return;
	}
	$('body').append('<div id="modal-overlay"></div>');
	$('#modal-overlay').show();

	$('#menu_remaining_score').show();
	$('#menu_exchange_scores').show();
	$('#menu_previous_leg').show();
	$('#menu_end_leg').show();
	if (n01_data.options.inputLeft === 1) {
		$('#menu_remaining_score').hide();
	}
	if (n01_data.gameOptions.com[0] === 1 || n01_data.gameOptions.com[1] === 1) {
		$('#menu_remaining_score').hide();
		$('#menu_exchange_scores').hide();
		$('#menu_previous_leg').hide();
		$('#menu_end_leg').hide();
	}
	
	centeringObject($("#general_menu"));
	$('#general_menu').show();
	
	function generalMenuClose() {
		$('#general_menu').hide();
		$('#modal-overlay').remove();
		$(document).off('keydown.general_menu');
	}

	$('#modal-overlay').unbind().click(function() {
		generalMenuClose();
		setFocus();
		return false;
	});
	
	$('#menu_remaining_score').unbind().click(function() {
		if (n01_data.options.inputLeft === 1) {
			return false;
		}
		if (n01_data.gameOptions.com[0] === 1 || n01_data.gameOptions.com[1] === 1) {
			return false;
		}
		generalMenuClose();
		remainingScore();
		setFocus();
		return false;
	});
	$('#menu_exchange_scores').unbind().click(function() {
		if (n01_data.gameOptions.com[0] === 1 || n01_data.gameOptions.com[1] === 1) {
			return false;
		}
		generalMenuClose();
		exchangeScores();
		return false;
	});
	$('#menu_previous_leg').unbind().click(function() {
		if (n01_data.gameOptions.com[0] === 1 || n01_data.gameOptions.com[1] === 1) {
			return false;
		}
		generalMenuClose();
		previousConfirm();
		return false;
	});
	$('#menu_end_leg').unbind().click(function() {
		if (n01_data.gameOptions.com[0] === 1 || n01_data.gameOptions.com[1] === 1) {
			return false;
		}
		generalMenuClose();
		middleMenuOpen();
		return false;
	});
	$('#menu_option').unbind().click(function() {
		generalMenuClose();
		window.location.href = n01_data.subPagePath + 'option.html';
		return false;
	});
	$('#menu_cancel').unbind().click(function() {
		generalMenuClose();
		setFocus();
		return false;
	});

	$(document).on('keydown.general_menu', function(e) {
		switch (e.keyCode) {
		case 49:	// 1
		case 97:	// 1
			$('#menu_remaining_score').click();
			break;
		case 50:	// 2
		case 98:	// 2
			$('#menu_exchange_scores').click();
			break;
		case 51:	// 3
		case 99:	// 3
			$('#menu_previous_leg').click();
			break;
		case 52:	// 4
		case 100:	// 4
			$('#menu_end_leg').click();
			break;
		case 53:	// 5
		case 101:	// 5
			$('#menu_option').click();
			break;
		case 27:	// ESC
			$('#menu_cancel').click();
			break;
		}
	});
}

function finishMenuOpen() {
	if($('#modal-overlay')[0]) {
		return;
	}
	$('body').append('<div id="modal-overlay"></div>');
	$('#modal-overlay').show();

	$("#finish_third").prependTo("#finish_menu ul");
	var left = currentLegData().playerData[currentLegData().selectPlayer][currentLegData().selectRound].left;
	if (left > 120) {
		$('#finish_second').hide();
	} else {
		$("#finish_second").insertBefore("#finish_third");
		$('#finish_second').show();
	}
	if (left > 60) {
		$('#finish_first').hide();
	} else {
		$("#finish_first").insertBefore("#finish_second");
		$('#finish_first').show();
	}
	centeringObject($("#finish_menu"));
	$('#finish_menu').show();
	
	function finishMenuClose() {
		$('#finish_menu').hide();
		$('#modal-overlay').remove();
		$(document).off('keydown.finish_menu');
	}

	$('#modal-overlay').unbind().click(function() {
		finishMenuClose();
		setFocus();
		return false;
	});
	
	$('#finish_first').unbind().click(function() {
		finishMenuClose();
		finishConfirm(1);
		return false;
	});
	$('#finish_second').unbind().click(function() {
		finishMenuClose();
		finishConfirm(2);
		return false;
	});
	$('#finish_third').unbind().click(function() {
		finishMenuClose();
		finishConfirm(3);
		return false;
	});
	$('#finish_cancel').unbind().click(function() {
		finishMenuClose();
		setFocus();
		return false;
	});

	$(document).on('keydown.finish_menu', function(e) {
		switch (e.keyCode) {
		case 49:	// 1
		case 97:	// 1
			if (left > 60) {
				break;
			}
		//$FALLTHROUGH$
		case 50:	// 2
		case 98:	// 2
			if (left > 120) {
				break;
			}
		//$FALLTHROUGH$
		case 51:	// 3
		case 99:	// 3
			finishMenuClose();
			if (e.keyCode <= 51) {
				finishConfirm(e.keyCode - 48);
			} else {
				finishConfirm(e.keyCode - 96);
			}
			break;
		case 27:	// ESC
			$('#finish_cancel').click();
			break;
		}
	});
}

function finishMsgOpen(player, dart, darts) {
	var oldInputScore = getCurrentScore();
	switch (dart) {
	case 1:
		setCurrentScore('x1');
		break;
	case 2:
		setCurrentScore('x2');
		break;
	case 3:
		setCurrentScore('x3');
		break;
	}
	setFinishLeft();

	if($('#modal-overlay')[0]) {
		return;
	}
	$('body').append('<div id="modal-overlay"></div>');
	$('#modal-overlay').show();

	$('#msg_title').text(n01_data.setData.statsData[player].name);
	$('#msg_text').text(res.game_shot_msg_prefix + dart + res.game_shot_msg_suffix + ' (' + darts + res.game_shot_msg_darts + ')');
	centeringObject($("#popup_message"));
	$('#popup_message').show();

	function messageClose(cancel) {
		$('#popup_message').hide();
		$('#modal-overlay').remove();
		$(document).off('keydown.finish_message');
		if (cancel) {
			setCurrentScore(oldInputScore);
			showLeft();
		}
		setFocus();
	}

	$('#msg_ok').unbind().click(function() {
		messageClose(false);
		finish(dart);
		return false;
	});
	$('#msg_cancel').unbind().click(function() {
		messageClose(true);
		return false;
	});
	
	$(document).on('keydown.finish_message', function(e) {
		switch (e.keyCode) {
		case 13:	// Enter
			messageClose(false);
			finish(dart);
			break;
		case 27:	// ESC
			$('#msg_cancel').click();
			break;
		}
	});
}

function middleMenuOpen() {
	if($('#modal-overlay')[0]) {
		return;
	}
	$('body').append('<div id="modal-overlay"></div>');
	$('#modal-overlay').show();

	centeringObject($("#middle_menu"));
	$('#middle_menu').show();
	
	function middleMenuClose() {
		$('#middle_menu').hide();
		$('#modal-overlay').remove();
		$(document).off('keydown.middle_menu');
	}

	$('#modal-overlay').unbind().click(function() {
		middleMenuClose();
		setFocus();
		return false;
	});
	
	$('#middle_p1win').unbind().click(function() {
		middleMenuClose();
		middleConfirm(0);
		return false;
	});
	$('#middle_p2win').unbind().click(function() {
		middleMenuClose();
		middleConfirm(1);
		return false;
	});
	$('#middle_draw').unbind().click(function() {
		middleMenuClose();
		middleConfirm(2);
		return false;
	});
	$('#middle_cancel').unbind().click(function() {
		middleMenuClose();
		setFocus();
		return false;
	});

	$(document).on('keydown.middle_menu', function(e) {
		switch (e.keyCode) {
		case 49:	// 1
		case 50:	// 2
		case 51:	// 3
			middleMenuClose();
			middleConfirm(e.keyCode - 49);
			break;
		case 97:	// 1
		case 98:	// 2
		case 99:	// 3
			middleMenuClose();
			middleConfirm(e.keyCode - 97);
			break;
		case 27:	// ESC
			$('#middle_cancel').click();
			break;
		}
	});
}

function middleMsgOpen(player) {
	if($('#modal-overlay')[0]) {
		return;
	}
	$('body').append('<div id="modal-overlay"></div>');
	$('#modal-overlay').show();
	
	switch (player) {
	case 0:
		$('#msg_title').text(res.middle_p1win);
		break;
	case 1:
		$('#msg_title').text(res.middle_p2win);
		break;
	case 2:
		$('#msg_title').text(res.draw_msg);
		break;
	}
	$('#msg_text').text('');
	centeringObject($("#popup_message"));
	$('#popup_message').show();

	function messageClose() {
		$('#popup_message').hide();
		$('#modal-overlay').remove();
		$(document).off('keydown.middle_message');
		setFocus();
	}

	$('#msg_ok').unbind().click(function() {
		messageClose();
		middle(player);
		return false;
	});
	$('#msg_cancel').unbind().click(function() {
		messageClose();
		return false;
	});
	
	$(document).on('keydown.middle_message', function(e) {
		switch (e.keyCode) {
		case 13:	// Enter
			messageClose();
			middle(player);
			break;
		case 27:	// ESC
			$('#msg_cancel').click();
			break;
		}
	});
}

function previousMsgOpen() {
	if($('#modal-overlay')[0]) {
		return;
	}
	$('body').append('<div id="modal-overlay"></div>');
	$('#modal-overlay').show();
	
	$('#msg_title').text(res.previous_leg_confirm);
	$('#msg_text').text('');
	centeringObject($("#popup_message"));
	$('#popup_message').show();

	function messageClose() {
		$('#popup_message').hide();
		$('#modal-overlay').remove();
		$(document).off('keydown.previous_message');
		setFocus();
	}

	$('#msg_ok').unbind().click(function() {
		messageClose();
		previousLeg();
		return false;
	});
	$('#msg_cancel').unbind().click(function() {
		messageClose();
		return false;
	});
	
	$(document).on('keydown.previous_message', function(e) {
		switch (e.keyCode) {
		case 13:	// Enter
			messageClose();
			previousLeg();
			break;
		case 27:	// ESC
			$('#msg_cancel').click();
			break;
		}
	});
}

// COM
var throwIndex;
var throwList;
var throwScore;
var comCancel = false;
var comTimerInterval = 1000;

function comStart() {
	if($('#modal-overlay')[0]) {
		return;
	}
	$('body').append('<div id="modal-overlay"></div>');
	$('#modal-overlay').css('background-color', 'transparent');
	$('#modal-overlay').show();

	$('#modal-overlay').unbind().click(function() {
		if (n01_data.gameOptions.com[0] === 1 && n01_data.gameOptions.com[1] === 1) {
			// 両方COMの場合のみキャンセル可とする
			comCancel = true;
		}
	});

	// 表示の初期化
	$('#com_throw_1').text('');
	$('#com_throw_2').text('');
	$('#com_throw_3').text('');
	centeringObject($("#com_throw"));
	$('#com_throw').fadeIn('fast');

	// データの初期化
	throwIndex = 0;
	throwList = [];
	throwScore = [0, 0, 0];
	comCancel = false;
	setTimeout(comTimer, comTimerInterval);
}

function comTimer() {
	if (comCancel === true) { 
		$('#com_throw').hide();
		$('#modal-overlay').remove();
		return;
	}
	if (throwIndex >= 3) {
		comEnd();
		return;
	}
	
	// COMスコアの取得
	var left = currentLegData().playerData[currentLegData().selectPlayer][currentLegData().selectRound].left;
	left -= (throwScore[0] + throwScore[1] + throwScore[2]);
	if (left <= 1) {
		comEnd();
		return;
	}
	var vsLeft = currentLegData().playerData[(currentLegData().selectPlayer === 0) ? 1 : 0][currentLegData().selectRound].left;
	var throwData = n01_com.getComThrow(left, vsLeft, throwIndex, n01_data.gameOptions.comLevel[currentLegData().selectPlayer]);
	throwList.push(throwData);
	throwScore[throwIndex] = throwData.target * throwData.segment;

	// スコアの表示
	var scoreStr;
	switch(throwData.segment) {
	case n01_com.SEGMENT_SINGLE:
		scoreStr = 'S' + throwData.target;
		break;
	case n01_com.SEGMENT_DOUBLE:
		scoreStr = 'D' + throwData.target;
		break;
	case n01_com.SEGMENT_TRIPLE:
		scoreStr = 'T' + throwData.target;
		break;
	}
	if (throwData.target === 0) {
		scoreStr = '0';
	}
	switch(throwIndex) {
	case 0:
		$('#com_throw_1').text(scoreStr);
		break;
	case 1:
		$('#com_throw_2').text(scoreStr);
		break;
	case 2:
		$('#com_throw_3').text(scoreStr);
		break;
	}
	throwIndex++;
	setTimeout(comTimer, comTimerInterval);
}

function comEnd() {
	$('#com_throw').fadeOut('fast');
	$('#modal-overlay').remove();

	var left = currentLegData().playerData[currentLegData().selectPlayer][currentLegData().selectRound].left;
	left -= (throwScore[0] + throwScore[1] + throwScore[2]);
	if (left === 0 && throwList[throwIndex - 1].segment === n01_com.SEGMENT_DOUBLE) {
		// Finish
		comFinishMsgOpen(currentLegData().selectPlayer, throwIndex, (currentLegData().selectRound * 3) + throwIndex);
	} else if (left <= 1) {
		// BUST
		setCurrentScore(0);
		scrollRound(currentLegData().selectRound);
		nextScore();
		changeNextSelect();
	} else {
		setCurrentScore(throwScore[0] + throwScore[1] + throwScore[2]);
		scrollRound(currentLegData().selectRound);
		nextScore();
		changeNextSelect();
	}
}

function comFinishMsgOpen(player, dart, darts) {
	if($('#modal-overlay')[0]) {
		return;
	}
	switch (dart) {
	case 1:
		setCurrentScore('x1');
		break;
	case 2:
		setCurrentScore('x2');
		break;
	case 3:
		setCurrentScore('x3');
		break;
	}
	setFinishLeft();

	$('body').append('<div id="modal-overlay"></div>');
	$('#modal-overlay').show();
	
	$('#msg_com_title').text(n01_data.setData.statsData[player].name);
	$('#msg_com_text').text(res.game_shot_msg_prefix + dart + res.game_shot_msg_suffix + ' (' + darts + res.game_shot_msg_darts + ')');
	centeringObject($("#popup_message_com"));
	$('#popup_message_com').show();

	function messageClose() {
		$('#popup_message_com').hide();
		$('#modal-overlay').remove();
		$(document).off('keydown.com_finish_message');
		setFocus();
	}

	$('#msg_com_ok').unbind().click(function() {
		messageClose();
		finish(dart);
		return false;
	});
	
	$(document).on('keydown.com_finish_message', function(e) {
		switch (e.keyCode) {
		case 13:	// Enter
			messageClose();
			finish(dart);
			break;
		}
	});
}

function comDrawMsgOpen() {
	if($('#modal-overlay')[0]) {
		return;
	}
	$('body').append('<div id="modal-overlay"></div>');
	$('#modal-overlay').show();
	
	$('#msg_com_title').text(res.draw_msg);
	$('#msg_com_text').text('');
	centeringObject($("#popup_message_com"));
	$('#popup_message_com').show();

	function messageClose() {
		$('#popup_message_com').hide();
		$('#modal-overlay').remove();
		$(document).off('keydown.com_draw_message');
		setFocus();
	}

	$('#msg_com_ok').unbind().click(function() {
		messageClose();
		middle(2);
		return false;
	});
	
	$(document).on('keydown.com_draw_message', function(e) {
		switch (e.keyCode) {
		case 13:	// Enter
			messageClose();
			middle(2);
			break;
		}
	});
}

// Util
function currentLegData() {
	if (n01_data.setData === null) {
		return null;
	}
	return n01_data.setData.legData[n01_data.setData.currentLeg];
}

function getScoreObj(round, player) {
	if (player === 0) {
		return $('#round_' + round).find('.p1score');
	} else {
		return $('#round_' + round).find('.p2score');
	}
}

function getLeftObj(round, player) {
	if (player === 0) {
		return $('#round_' + round).find('.p1left');
	} else {
		return $('#round_' + round).find('.p2left');
	}
}
