/*
 * n01_score.js
 *
 * Copyright (C) 1996-2017 by Ohno Tomoaki. All rights reserved.
 */

/*eslint-env browser, jquery*/
/*globals n01_util n01_data*/
var resources = {
	en : {
	},
	ja : {
		header_title : "スコア",
		button_cancel : "戻る",
		button_stats : "Stats",
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
		$('#button_stats').text(res.button_stats);
	}
});

$(document).ready( function() {
	$('#header').show();
	init();
	resize();

	$(window).resize(function() {
		resize();
	});

	$(document).on('keydown', function(e) {
		switch (e.keyCode) {
		case 83:	// s
			$('#button_stats').click();
			break;
		case 27:	// ESC
			setTimeout(function() {
				$('#button_cancel').click();
			}, 100);
			break;
		}
	});

	$('#button_cancel').click(function() {
		window.location.href = n01_data.topPage;
	});
	$('#button_stats').click(function() {
		window.location.href = 'stats.html';
	});
});

function resize() {
	var windowSize = ($(window).width() < $(window).height()) ? $(window).width() : $(window).height();
	var bodyFont = windowSize * 0.05;
	$('body').css('font-size', bodyFont + 'px');
	
	var headerTableMargin = windowSize * 0.015;
	$('.header_table').css('margin-bottom', headerTableMargin + 'px');

	// スコア一覧
	var scoreHeaderHeight = windowSize * 0.055;
	var scoreHeaderFont = windowSize * 0.04;
	$('.score_table th').css('height', scoreHeaderHeight + 'px');
	$('.score_table th').css('font-size', scoreHeaderFont + 'px');

	var scoreHeight = windowSize * 0.095;
	var scoreFont = windowSize * 0.07;
	$('.score_table td').css('height', scoreHeight + 'px');
	$('.score_table td').css('font-size', scoreFont + 'px');
	$('#hidden_table td').css('height', scoreHeight + 'px');
	$('#hidden_table td').css('font-size', scoreFont + 'px');

	resizeCircleTon(windowSize);

	var sepMargin = windowSize * 0.05;
	$('.sep').css('margin', sepMargin + 'px 0');

	var border = windowSize * 0.002;
	if (border < 1) {
		border = 1;
	}
	$('.score_table th').css('border', border + 'px solid #555555');
	$('.score_table td').css('border', border + 'px solid #555555');

	n01_util.headerResize();
}

function resizeCircleTon(windowSize) {
	if (n01_data.options.circleTon !== 1) {
		return;
	}
	var tonWidth = $('.score_input').width() * 4;
	var tonHeight = $('.score_input').height() * 4;
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
	var margin = Math.floor(windowSize * 0.004);
	if (margin < 1) {
		margin = 1;
	}
	ctx.arc(tonHeight / 2, tonHeight / 2, tonHeight/ 2 - margin * 4, 0, Math.PI * 2, false);
	ctx.restore();
	ctx.strokeStyle = '#a0a0a0';
	var border = Math.floor(windowSize * 0.004);
	if (border < 1) {
		border = 1;
	}
	ctx.lineWidth = border * 4;
	ctx.stroke();
	$('.score_input').each(function(i, elem) {
		setCircleTon($(elem));
	});
}

function init() {
	n01_data.restoreOptions();
	n01_data.restoreSetData();

	for (var i = 0; i < n01_data.setData.legData.length; i++) {
		var leg = n01_data.setData.legData[i];
		if (leg.endFlag === 0) {
			break;
		}
		if (i > 0) {
			$('#article').append('<p class="sep" />');
		}
		var objTable = $('#score_template').clone(false).appendTo('#article');
		objTable.attr('id', 'Leg_' + i);

		objTable.find('.leg').text((i + 1) + " Leg");
		if (leg.first === 0) {
			objTable.find('.p1_name').text("* " + n01_data.setData.statsData[0].name);
			objTable.find('.p2_name').text(n01_data.setData.statsData[1].name);
		} else {
			objTable.find('.p1_name').text(n01_data.setData.statsData[0].name);
			objTable.find('.p2_name').text("* " + n01_data.setData.statsData[1].name);
		}
		if (leg.winner === 0) {
			objTable.find('.p1_name').css('text-decoration', 'underline');
		} else if (leg.winner === 1) {
			objTable.find('.p2_name').css('text-decoration', 'underline');
		}
		
		objTable.find('.score_table').attr('id', 'score_table_' + i);
		objTable.find('.p1left').text(leg.playerData[0][0].left);
		objTable.find('.p2left').text(leg.playerData[1][0].left);
	
		var round = leg.currentRound + 1;
		if (leg.middleForDiddle === 1) {
			round = leg.currentRound;
		}
		for (var j = 1; j <= round; j++) {
			var obj = $('#score_list_score').clone(false).appendTo('#score_table_' + i);
			obj.attr('id', 'round_' + j);
			if (n01_data.options.roundDarts === 1) {
				obj.find('.score_round').text(j * 3);
			} else {
				obj.find('.score_round').text(j);
			}
			if (leg.playerData[0][j] != undefined && isShowRound(leg, j, 0)) {
				obj.find('.p1score').text(convScore(leg.playerData[0][j].score));
				obj.find('.p1left').text(convLeft(leg.playerData[0][j].left));
				setCircleTon(obj.find('.p1score'));
			}
			if (leg.playerData[1][j] != undefined && isShowRound(leg, j, 1)) {
				obj.find('.p2score').text(convScore(leg.playerData[1][j].score));
				obj.find('.p2left').text(convLeft(leg.playerData[1][j].left));
				setCircleTon(obj.find('.p2score'));
			}
		}
		objTable.show();
	}
}

function convScore(score) {
	if (score < 0) {
		return "x" + (score * -1);
	}
	return score;
}

function convLeft(left) {
	if (left === 0) {
		return "";
	}
	return left;
}

function isShowRound(leg, round, player) {
	if (round === leg.currentRound + 1 && leg.first === leg.currentPlayer && leg.currentPlayer !== player) {
		return false;
	}
	return true;
}

function setCircleTon(obj) {
	if (n01_data.options.circleTon !== 1) {
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
