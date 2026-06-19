/*
 * n01_stats.js
 *
 * Copyright (C) 1996-2017 by Ohno Tomoaki. All rights reserved.
 */

/*eslint-env browser, jquery*/
/*globals n01_data n01_util*/
var resources = {
	en : {
	},
	ja : {
		header_title : "Stats",
		button_cancel : "戻る",
		button_history : "スコア",
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
		$('#button_history').text(res.button_history);
	}
});

$(document).ready( function() {
	$('#header').show();
	$('#article').show();
	init();
	resize();

	$(window).resize(function() {
		resize();
	});

	$(document).on('keydown', function(e) {
		switch (e.keyCode) {
		case 72:	// h
			$('#button_history').click();
			break;
		case 27:	// ESC
			setTimeout(function() {
				$('#button_cancel').click();
			}, 100);
			break;
		}
	});

	$('#p1_name,#p2_name').click(function() {
		if (n01_data.gameOptions.com[0] === 0 || n01_data.gameOptions.com[1] === 0) {
			window.location.href = 'rename.html';
		}
	});

	$('#button_cancel').click(function() {
		window.location.href = n01_data.topPage;
	});
	$('#button_history').click(function() {
		window.location.href = 'score.html';
	});
});

function resize() {
	n01_util.headerResize();

	var windowSize = ($(window).height() - $('#header_table').height()) / 1.2;
	if (windowSize > $(window).width()) {
		windowSize = $(window).width();
	}

	var bodyFont = windowSize * 0.06;
	$('body').css('font-size', bodyFont + 'px');

	var marginTop = windowSize * 0.01;
	$('.title_table').css('margin-top', marginTop + 'px');

	var padding = windowSize * 0.015;
	$('.stats_table td').css('padding', padding + 'px 0');

	var width = windowSize * 1.8;
	if  (width > $(window).width()) {
		width = $('#article').width();
		$('.name_table').css('width', '100%');
		$('.stats_table').css('width', '100%');
	} else {
		$('.name_table').css('width', width + 'px');
		$('.stats_table').css('width', width + 'px');
	}

	var centerWidth = windowSize * 0.4;
	$('td.center').css('width', centerWidth + 'px');
	$('td.left').css('width', ((width - centerWidth) / 2) + 'px');
	$('td.right').css('width', ((width - centerWidth) / 2) + 'px');
	if  ($(window).height() > $(window).width()) {
		$('#p1_name').css('text-align', 'left');
		$('#p2_name').css('text-align', 'right');
		var nameCenterWidth = windowSize * 0.03;
		$('#p1_name').css('width', (width / 2 - nameCenterWidth) + 'px');
		$('#p2_name').css('width', (width / 2 - nameCenterWidth) + 'px');
		$('td.name_center').css('width', nameCenterWidth + 'px');
	} else {
		$('#p1_name').css('text-align', 'center');
		$('#p2_name').css('text-align', 'center');
		$('#p1_name').css('width', ((width - centerWidth) / 2) + 'px');
		$('#p2_name').css('width', ((width - centerWidth) / 2) + 'px');
		$('td.name_center').css('width', centerWidth + 'px');
	}

	var subtitleFont = windowSize * 0.065;
	$('.subtitle').css('font-size', subtitleFont + 'px');
	var subtitlePadding = windowSize * 0.008;
	$('.subtitle').css('padding', subtitlePadding + 'px 0');
}

function init() {
	n01_data.restoreOptions();
	n01_data.restoreGameOptions();
	n01_data.restoreSetData();
	
	$('#p1_name').text(n01_data.setData.statsData[0].name);
	$('#p2_name').text(n01_data.setData.statsData[1].name);
	
	$('#p1_legs').text(n01_data.setData.statsData[0].winLegs);
	$('#p2_legs').text(n01_data.setData.statsData[1].winLegs);
	
	var statsTmplate = {
		ton00Count: 0,
		ton40Count: 0,
		ton80Count: 0,
		highOut: 0,
		bestLeg: 0,
		worstLeg: 0,
		allScore: 0,
		allDarts: 0,
		winDarts: 0,
		winCount: 0,
		first9Score: 0,
		first9Darts: 0
	};
	
	var stats1 = $.extend(true, {}, statsTmplate);
	calcPlayer(stats1, 0);
	$('#p1_ton00').text(stats1.ton00Count);
	$('#p1_ton40').text(stats1.ton40Count);
	$('#p1_ton80').text(stats1.ton80Count);
	$('#p1_highout').text(stats1.highOut);
	$('#p1_best').text(stats1.bestLeg);
	$('#p1_worst').text(stats1.worstLeg);
	if (stats1.winCount > 0) {
		var p1darts = stats1.winDarts / stats1.winCount;
		$('#p1_darts').text(p1darts.toFixed(2));
	}
	if (stats1.allDarts > 0) {
		var p1score = stats1.allScore / stats1.allDarts;
		if (n01_data.options.avePPR === 1) {
			p1score *= 3;
		}
		$('#p1_score').text(p1score.toFixed(2));
	}
	if (stats1.first9Darts > 0) {
		var p1first9 = stats1.first9Score / stats1.first9Darts;
		if (n01_data.options.avePPR === 1) {
			p1first9 *= 3;
		}
		$('#p1_first9').text(p1first9.toFixed(2));
	}
	
	var stats2 = $.extend(true, {}, statsTmplate);
	calcPlayer(stats2, 1);
	$('#p2_ton00').text(stats2.ton00Count);
	$('#p2_ton40').text(stats2.ton40Count);
	$('#p2_ton80').text(stats2.ton80Count);
	$('#p2_highout').text(stats2.highOut);
	$('#p2_best').text(stats2.bestLeg);
	$('#p2_worst').text(stats2.worstLeg);
	if (stats2.winCount > 0) {
		var p2darts = stats2.winDarts / stats2.winCount;
		$('#p2_darts').text(p2darts.toFixed(2));
	}
	if (stats2.allDarts > 0) {
		var p2score = stats2.allScore / stats2.allDarts;
		if (n01_data.options.avePPR === 1) {
			p2score *= 3;
		}
		$('#p2_score').text(p2score.toFixed(2));
	}
	if (stats2.first9Darts > 0) {
		var p2first9 = stats2.first9Score / stats2.first9Darts;
		if (n01_data.options.avePPR === 1) {
			p2first9 *= 3;
		}
		$('#p2_first9').text(p2first9.toFixed(2));
	}
}

function calcPlayer(stats, player) {
	for (var i = 0; i < n01_data.setData.legData.length; i++) {
		calcLeg(stats, player, n01_data.setData.legData[i]);
		if (n01_data.setData.legData[i].endFlag === 0) {
			break;
		}
	}
}

function calcLeg(stats, player, leg) {
	var round;
	if (((leg.first !== leg.currentPlayer && leg.currentPlayer === player) || leg.first === leg.currentPlayer) ||
			leg.middleForDiddle === 1) {
		round = leg.currentRound;
	} else {
		round = leg.currentRound + 1;
	}
	var first9Score = 0;
	var first9Darts = 0;
	for (var i = 1; i <= round; i++) {
		if (leg.playerData[player][i] === undefined) {
			round = i - 1;
			break;
		}
		var score = leg.playerData[player][i].score;
		if (score >=100 && score < 140) {
			stats.ton00Count++;
		}
		if (score >=140 && score < 180) {
			stats.ton40Count++;
		}
		if (score === 180) {
			stats.ton80Count++;
		}
		if (i <= 3) {
			first9Score += score;
			first9Darts += 3;
		}
	}
	if (leg.endFlag === 1 && leg.winner === player) {
		var allScore;
		var allDarts;
		if (leg.middleForDiddle === 0) {
			allScore = leg.playerData[player][0].left;
			allDarts = leg.currentRound * 3 + leg.playerData[player][leg.currentRound + 1].score * -1;
			stats.allScore += allScore;
			stats.allDarts += allDarts;
			if (leg.currentRound + 1 <= 3) {
				first9Score = allScore;
				first9Darts = allDarts;
			}
			var highOut = leg.playerData[player][leg.currentRound].left;
			if (stats.highOut < highOut) {
				stats.highOut = highOut;
			}
			if (highOut >=100 && highOut < 140) {
				stats.ton00Count++;
			}
			if (highOut >=140 && highOut < 180) {
				stats.ton40Count++;
			}
			if (highOut === 180) {
				stats.ton80Count++;
			}
			if (stats.bestLeg === 0 || stats.bestLeg > allDarts) {
				stats.bestLeg = allDarts;
			}
			if (stats.worstLeg < allDarts) {
				stats.worstLeg = allDarts;
			}
			stats.winCount++;
			stats.winDarts += allDarts;
		} else {
			allScore = leg.playerData[player][0].left - leg.playerData[player][round].left;
			allDarts = round * 3;
			stats.allScore += allScore;
			stats.allDarts += allDarts;
			if (stats.bestLeg === 0 || stats.bestLeg > allDarts + 1) {
				stats.bestLeg = allDarts + 1;
			}
			if (stats.worstLeg < allDarts + 1) {
				stats.worstLeg = allDarts + 1;
			}
			stats.winCount++;
			stats.winDarts += allDarts + 1;
		}
	} else {
		stats.allScore += leg.playerData[player][0].left - leg.playerData[player][round].left;
		stats.allDarts += round * 3;
	}
	stats.first9Score += first9Score;
	stats.first9Darts += first9Darts;
}
