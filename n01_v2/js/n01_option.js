/*
 * n01_option.js
 *
 * Copyright (C) 1996-2017 by Ohno Tomoaki. All rights reserved.
 */

/*eslint-env browser, jquery*/
/*globals n01_data n01_util*/
var resources = {
	en : {
	},
	ja : {
		header_title : "オプション",
		button_cancel : "キャンセル",
		button_done : "完了",

		label_option_key_show : "数字キーを表示",
		label_option_left_score : "大きい残りスコアを表示",
		label_option_round_darts : "ラウンドはダーツ数で表示",
		label_option_circle_ton : "TONに丸を付ける",
		label_option_ppr : "3ダーツ平均表示",

		label_option_input_left : "残り点数も入力する",
		label_option_input_left_com : "COMの残り点数も入力する",

		label_option_small_keypad : "小さい数字キーを使用 (タブレット用)",
		label_option_input_tag : "INPUTタグを使用 (iOS+Bluetoothキーボード)",
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
		$('#button_done').text(res.button_done);

		$('#label_option_key_show').text(res.label_option_key_show);
		$('#label_option_left_score').text(res.label_option_left_score);
		$('#label_option_round_darts').text(res.label_option_round_darts);
		$('#label_option_circle_ton').text(res.label_option_circle_ton);
		$('#label_option_ppr').text(res.label_option_ppr);

		$('#label_option_input_left').text(res.label_option_input_left);
		$('#label_option_input_left_com').text(res.label_option_input_left_com);

		$('#label_option_small_keypad').text(res.label_option_small_keypad);
		$('#label_option_input_tag').text(res.label_option_input_tag);
	}
});

$(document).ready( function() {
	$('#header').show();
	$('#article').show();
	initSetting();
	resize();

	$(window).resize(function() {
		resize();
	});

	$(document).on('keydown', function(e) {
		switch (e.keyCode) {
		case 13:	// Enter
			$('#button_done').click();
			break;
		case 27:	// ESC
			setTimeout(function() {
				$('#button_cancel').click();
			}, 100);
			break;
		}
	});

	$('#button_cancel').click(function() {
		// n01に戻る
		window.location.href = n01_data.topPage;
	});

	$('#button_done').click(function() {
		n01_data.options.keyShow = ($('#option_key_show').prop('checked')) ? 1 : 0;
		n01_data.options.leftShow = ($('#option_left_score').prop('checked')) ? 1 : 0;
		n01_data.options.roundDarts = ($('#option_round_darts').prop('checked')) ? 1 : 0;
		n01_data.options.circleTon = ($('#option_circle_ton').prop('checked')) ? 1 : 0;
		n01_data.options.avePPR = ($('#option_option_ppr').prop('checked')) ? 1 : 0;

		n01_data.options.inputLeft = ($('#option_input_left').prop('checked')) ? 1 : 0;
		n01_data.options.inputLeftCom = ($('#option_input_left_com').prop('checked')) ? 1 : 0;

		n01_data.options.smallKeypad = ($('#option_small_keypad').prop('checked')) ? 1 : 0;
		n01_data.options.inputTag = ($('#option_input_tag').prop('checked')) ? 1 : 0;
		n01_data.saveOptions();

		// n01に戻る
		window.location.href = n01_data.topPage;
	});
});

function connectText(textid, ischecked) {
	$('#' + textid).prop('disabled', !ischecked);
}

function initSetting() {
	// Optionの読み込み
	n01_data.restoreOptions();
	$('#option_key_show').prop('checked', (n01_data.options.keyShow === 1) ? true : false);
	$('#option_left_score').prop('checked', (n01_data.options.leftShow === 1) ? true : false);
	$('#option_round_darts').prop('checked', (n01_data.options.roundDarts === 1) ? true : false);
	$('#option_circle_ton').prop('checked', (n01_data.options.circleTon === 1) ? true : false);
	$('#option_option_ppr').prop('checked', (n01_data.options.avePPR === 1) ? true : false);

	$('#option_input_left').prop('checked', (n01_data.options.inputLeft === 1) ? true : false);
	$('#option_input_left_com').prop('checked', (n01_data.options.inputLeftCom === 1) ? true : false);
	connectText('option_input_left_com', $('#option_input_left').prop('checked'));

	$('#option_small_keypad').prop('checked', (n01_data.options.smallKeypad === 1) ? true : false);
	$('#option_input_tag').prop('checked', (n01_data.options.inputTag === 1) ? true : false);
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

	var pMargin = windowSize * 0.03;
	$('p').css('margin-bottom', pMargin + 'px');

	var checkWidth = windowSize * 0.05;
	$('input[type="checkbox"]').css('width', checkWidth + 'px');
	var checkHeight = windowSize * 0.05;
	$('input[type="checkbox"]').css('height', checkHeight + 'px');

	var indent = windowSize * 0.07;
	$('.indent').css('padding-left', indent + 'px');

	var hrMargin = windowSize * 0.03;
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
	}
	var headerHeight = $('#header_table').height();
	$('#header_back').css('height', headerHeight + 'px');
	$('#article').css('padding', headerHeight + 'px 0 0 0');
}
