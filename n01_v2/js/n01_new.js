/*
 * n01_new.js
 *
 * Copyright (C) 1996-2017 by Ohno Tomoaki. All rights reserved.
 */

/*eslint-env browser, jquery*/
/*globals n01_data n01_util*/
var resources = {
	en : {
	},
	ja : {
		header_title : "新規ゲーム",
		button_cancel : "キャンセル",
		button_game_on : "開始",

		title_player_name : "プレイヤー名",
		title_start_score : "開始スコア（ランダム）",
		label_limit_rounds : "ラウンド数を制限",

		label_option_p1_com : "Player 1をCOMにする",
		label_option_p2_com : "Player 2をCOMにする",

		title_practice : "スコア練習モード",
		label_option_input_left : "残り点数も入力する",
		label_option_input_left_com : "COMの残り点数も入力する",

		title_hadicap : "ハンディキャップ",

		schedule_button : "スケジュールモード",
	},
};
var res = {};
var lang = 'en';
$(document).ready(function() {
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
		$('#header_title').text(res.header_title);
		$('#button_cancel').text(res.button_cancel);
		$('#button_game_on').text(res.button_game_on);

		$('#title_player_name').text(res.title_player_name);
		$('#title_start_score').text(res.title_start_score);

		$('#label_option_p1_com').text(res.label_option_p1_com);
		$('#label_option_p2_com').text(res.label_option_p2_com);

		$('#title_practice').text(res.title_practice);
		$('#label_option_input_left').text(res.label_option_input_left);
		$('#label_option_input_left_com').text(res.label_option_input_left_com);

		$('#title_hadicap').text(res.title_hadicap);
		$('#label_limit_rounds').text(res.label_limit_rounds);

		$('#schedule_button').val(res.schedule_button);
	}
});

$(document).ready( function() {
	$('#header').show();
	$('#contents').show();
	initSetting();
	resize();

	$(window).resize(function() {
		resize();
	});

	$(document).on('keydown', function(e) {
		switch (e.keyCode) {
		case 13:	// Enter
			$('#button_game_on').click();
			break;
		case 27:	// ESC
			setTimeout(function() {
				$('#button_cancel').click();
			}, 100);
			break;
		}
	});

	$('#schedule_button').click(function() {
		window.location.href = '../schedule/index.html';
	});

	$('#menu_button').click(function() {
		// Menu
		window.location.href = '../menu/';
	});

	$('#tips_button').click(function() {
		// Tips
		window.location.href = '../n01_tips/';
	});

	$('#button_cancel').click(function() {
		// n01に戻る
		window.location.href = n01_data.topPage;
	});

	$('#button_game_on').click(function() {
		// GameOptionの保存
		n01_data.gameOptions.playerName[0] = $('#p1_name').val();
		n01_data.gameOptions.playerName[1] = $('#p2_name').val();
		if ($('#limit_rounds').prop('checked')) {
			n01_data.gameOptions.roundLimit = 1;
		} else {
			n01_data.gameOptions.roundLimit = 0;
		}
		var rounds = $('#rounds').val();
		if (rounds === '') {
			rounds = 15;
		} else {
			rounds = parseInt(rounds, 10);
			if (rounds < 0) {
				rounds = 15;
			}
		}
		n01_data.gameOptions.maxRound = rounds;

		var randomMin = parseInt($('#random_min').val(), 10);
		if (isNaN(randomMin) || randomMin < 2) { randomMin = 41; }
		var randomMax = parseInt($('#random_max').val(), 10);
		if (isNaN(randomMax) || randomMax > 170) { randomMax = 170; }
		if (randomMin > randomMax) { randomMin = randomMax; }
		n01_data.gameOptions.randomMin = randomMin;
		n01_data.gameOptions.randomMax = randomMax;

		n01_data.gameOptions.com[0] = ($('#option_p1_com').prop('checked')) ? 1 : 0;
		n01_data.gameOptions.comLevel[0] = parseInt($('#option_p1_com_level').val(), 10);
		
		n01_data.gameOptions.com[1] = ($('#option_p2_com').prop('checked')) ? 1 : 0;
		n01_data.gameOptions.comLevel[1] = parseInt($('#option_p2_com_level').val(), 10);
		
		n01_data.gameOptions.p1_handicap = ($('#p1_handicap_check').prop('checked')) ? 1 : 0;
		var p1_handicap_score = $('#p1_handicap').val();
		if (p1_handicap_score === '') {
			p1_handicap_score = 501;
		} else {
			p1_handicap_score = parseInt(p1_handicap_score, 10);
			if (p1_handicap_score <= 1) {
				p1_handicap_score = 501;
			}
		}
		n01_data.gameOptions.p1_handicap_score = p1_handicap_score;

		n01_data.gameOptions.p2_handicap = ($('#p2_handicap_check').prop('checked')) ? 1 : 0;
		var p2_handicap_score = $('#p2_handicap').val();
		if (p2_handicap_score === '') {
			p2_handicap_score = 501;
		} else {
			p2_handicap_score = parseInt(p2_handicap_score, 10);
			if (p2_handicap_score <= 1) {
				p2_handicap_score = 501;
			}
		}
		n01_data.gameOptions.p2_handicap_score = p2_handicap_score;
		n01_data.saveGameOptions();

		// Optionの保存
		n01_data.options.inputLeft = ($('#option_input_left').prop('checked')) ? 1 : 0;
		n01_data.options.inputLeftCom = ($('#option_input_left_com').prop('checked')) ? 1 : 0;
		n01_data.saveOptions();

		// セット情報の初期化
		n01_data.initSet();

		// n01に戻る
		window.location.href = n01_data.topPage;
	});
});

function connectText(textid, ischecked) {
	$('#' + textid).prop('disabled', !ischecked);
}

function initSetting() {
	// GameOptionの読み込み
	n01_data.restoreGameOptions();
	
	$('#p1_name').val(n01_data.gameOptions.playerName[0]);
	$('#p2_name').val(n01_data.gameOptions.playerName[1]);

	$('#random_min').val(n01_data.gameOptions.randomMin || 41);
	$('#random_max').val(n01_data.gameOptions.randomMax || 170);

	$('#limit_rounds').prop('checked', (n01_data.gameOptions.roundLimit) ? true : false);
	$('#rounds').val(n01_data.gameOptions.maxRound);
	connectText('rounds', $('#limit_rounds').prop('checked'));
	
	$('#option_p1_com').prop('checked', (n01_data.gameOptions.com[0]) ? true : false);
	$('#option_p1_com_level').val(n01_data.gameOptions.comLevel[0]);
	connectText('option_p1_com_level', $('#option_p1_com').prop('checked'));

	$('#option_p2_com').prop('checked', (n01_data.gameOptions.com[1]) ? true : false);
	$('#option_p2_com_level').val(n01_data.gameOptions.comLevel[1]);
	connectText('option_p2_com_level', $('#option_p2_com').prop('checked'));

	$('#p1_handicap_check').prop('checked', (n01_data.gameOptions.p1_handicap) ? true : false);
	$('#p1_handicap').val(n01_data.gameOptions.p1_handicap_score);
	connectText('p1_handicap', $('#p1_handicap_check').prop('checked'));

	$('#p2_handicap_check').prop('checked', (n01_data.gameOptions.p2_handicap) ? true : false);
	$('#p2_handicap').val(n01_data.gameOptions.p2_handicap_score);
	connectText('p2_handicap', $('#p2_handicap_check').prop('checked'));
	
	// Optionの読み込み
	n01_data.restoreOptions();
	$('#option_input_left').prop('checked', (n01_data.options.inputLeft === 1) ? true : false);
	$('#option_input_left_com').prop('checked', (n01_data.options.inputLeftCom === 1) ? true : false);
	connectText('option_input_left_com', $('#option_input_left').prop('checked'));
}

var oldWidth = 0;
function resize() {
	if (oldWidth !== 0 && oldWidth === $(window).width()) {
		// ソフトキーボード表示／非表示の可能性があるためサイズ変更しない
		return;
	}
	oldWidth = $(window).width();
	var windowSize = ($(window).width() < $(window).height()) ? $(window).width() : $(window).height();
	var bodyFont = windowSize * 0.06;
	$('body').css('font-size', bodyFont + 'px');
	$('input').css('font-size', bodyFont + 'px');
	$('select').css('font-size', bodyFont + 'px');

	var pMargin = windowSize * 0.02;
	$('p').css('margin-bottom', pMargin + 'px');

	var checkWidth = windowSize * 0.05;
	$('input[type="checkbox"]').css('width', checkWidth + 'px');
	var checkHeight = windowSize * 0.05;
	$('input[type="checkbox"]').css('height', checkHeight + 'px');

	var inputPadding = windowSize * 0.015;
	$('input[type="text"]').css('padding', inputPadding + 'px');
	$('input[type="number"]').css('padding', inputPadding + 'px');
	$('select').css('padding', inputPadding + 'px');

	var buttonMargin = windowSize * 0.02;
	$('input[type="button"]').css('margin', buttonMargin + 'px 0 ' + (buttonMargin * 2) + 'px 0');
	var buttonPadding = windowSize * 0.02;
	$('input[type="button"]').css('padding', buttonPadding + 'px');

	var topPadding = windowSize * 0.02;
	$('#title_player_name').css('padding-top', topPadding + 'px');

	var detailFont = windowSize * 0.04;
	$('#menu_detail').css('font-size', detailFont + 'px');

	var indent = windowSize * 0.07;
	$('.indent').css('padding-left', indent + 'px');

	var hrMargin = windowSize * 0.05;
	$('hr').css('margin', hrMargin + 'px 0');

	n01_util.headerResize();
	
	if (lang === 'ja') {
		var cancelButtonWidth;
		if ($(window).width() < $(window).height()) {
			cancelButtonWidth = windowSize * 0.32;
		} else {
			cancelButtonWidth = windowSize * 0.27;
		}
		$('#td_button_cancel').css('width', cancelButtonWidth + 'px');
	} else {
		var gameOnButtonWidth = windowSize * 0.27;
		$('#td_button_game_on').css('width', gameOnButtonWidth + 'px');
	}
	var headerHeight = $('#header_table').height();
	$('#header_back').css('height', headerHeight + 'px');
	$('#article').css('padding', headerHeight + 'px 0 0 0');
}
