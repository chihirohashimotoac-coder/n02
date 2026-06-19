/*
 * n01_data.js
 *
 * Copyright (C) 1996-2015 by Ohno Tomoaki. All rights reserved.
 */

/*eslint-env browser, jquery*/
/*globals n01_util */
var n01_data = (function () {
	var me = {};

	// TOPページ(戻り用)
	me.topPage = '../n01.html';
	// SUBページのパス
	me.subPagePath = 'n01_v2/';

	// 設定用接頭辞
	me.generalPrefix = '';
	me.optionPrefix = '';

	// 設定
	me.options = {
		keyShow: 0,
		leftShow: 1,
		roundDarts: 1,
		circleTon: 1,
		avePPR: 1,
		smallKeypad: 0,
		inputTag: 0,
		inputLeft: 0,
		inputLeftCom: 0
	};
	me.saveOptions = function () {
		localStorage.setItem(me.generalPrefix + 'options', JSON.stringify(me.options));
	};
	me.restoreOptions = function () {
		var str = localStorage.getItem(me.generalPrefix + 'options');
		if (str !== null) {
			me.options = JSON.parse(str);
		} else {
			var ua = n01_util.getUserAgent();
			if (ua.isTablet) {
				me.options.smallKeypad = 1;
			}
			if (ua.isWindowsPhone || ua.isiOS || ua.isAndroid) {
				me.options.keyShow = 1;
			}
		}
	};

	// ゲーム設定
	me.gameOptions = {
	 	playerName: ['', ''],

		startScore: 501,
		roundLimit: 0,
		maxRound: 15,
		randomMin: 41,
		randomMax: 170,

		p1_handicap: 0,
	 	p1_handicap_score: 501,
		p2_handicap: 0,
	 	p2_handicap_score: 501,

	 	com: [0, 0],
	 	comLevel: [1, 1]
	};
	me.saveGameOptions = function () {
		localStorage.setItem(me.optionPrefix + 'gameOptions', JSON.stringify(me.gameOptions));
	};
	me.restoreGameOptions = function () {
		var str = localStorage.getItem(me.optionPrefix + 'gameOptions');
		if (str !== null) {
			me.gameOptions = JSON.parse(str);
			if (me.gameOptions.com === undefined) {
				me.gameOptions.com = [0, 0];
			}
			if (me.gameOptions.comLevel === undefined) {
				me.gameOptions.comLevel = [1, 1];
			}
		}
	};

	// セットデータ
	me.setData = {
		startTime: 0,
		currnetInput: '',
		leftMode: 0,
		leftModeError: 0,

		currentLeg: 0,
		legData: [],
		statsData: []
	};
	me.initLegData = {
		first: 0,
		currentRound: 0,
		currentPlayer: 0,
		selectRound: 0,
		selectPlayer: 0,
		endFlag: 0,
		middleForDiddle: 0,
		winner: 0,

		playerData: [[
			{score: 0, left: 0}
		],
		[
			{score: 0, left: 0}
		]]
	};
	me.initStatData = {
		name: '',
		winLegs: 0
	};

	// 1legのランダム開始スコアを生成する（直前と同じスコアは出さない）
	me.lastRandomScore = -1;
	me.generateRandomStartScore = function () {
		var min = (me.gameOptions.randomMin !== undefined) ? me.gameOptions.randomMin : 41;
		var max = (me.gameOptions.randomMax !== undefined) ? me.gameOptions.randomMax : 170;

		// 有効な3ダーツチェックアウトスコアを全列挙してmin-maxでフィルタ
		var allScores = [];
		var i;
		for (i = 2; i <= 158; i++) {
			allScores.push(i);
		}
		allScores.push(160, 161, 164, 167, 170);

		var candidates = allScores.filter(function(s) {
			return s >= min && s <= max && s !== me.lastRandomScore;
		});
		if (candidates.length === 0) {
			candidates = allScores.filter(function(s) { return s >= min && s <= max; });
		}
		if (candidates.length === 0) {
			candidates = [41];
		}

		var score = candidates[Math.floor(Math.random() * candidates.length)];
		me.lastRandomScore = score;
		return score;
	};

	me.initSet = function () {
		me.setData = {
			startTime: 0,
			currnetInput: '',
			leftMode: 0,
			leftModeError: 0,

			currentLeg: 0,
			legData: [],
			statsData: []
		};
		me.setData.legData.push($.extend(true, {}, me.initLegData));
		var randomScore = me.generateRandomStartScore();
		if (me.gameOptions.p1_handicap === 1) {
			me.setData.legData[0].playerData[0][0].left = me.gameOptions.p1_handicap_score;
		} else {
			me.setData.legData[0].playerData[0][0].left = randomScore;
		}
		if (me.gameOptions.p2_handicap === 1) {
			me.setData.legData[0].playerData[1][0].left = me.gameOptions.p2_handicap_score;
		} else {
			me.setData.legData[0].playerData[1][0].left = randomScore;
		}
		me.setData.statsData.push($.extend(true, {}, me.initStatData));
		if (me.gameOptions.com[0] === 1) {
			me.setData.statsData[0].name = 'COM(Lv.' + me.gameOptions.comLevel[0] + ')';
		} else {
			me.setData.statsData[0].name = me.gameOptions.playerName[0];
			if (me.setData.statsData[0].name === '') {
				me.setData.statsData[0].name = 'Player 1';
			}
		}
		me.setData.statsData.push($.extend(true, {}, me.initStatData));
		if (me.gameOptions.com[1] === 1) {
			me.setData.statsData[1].name = 'COM(Lv.' + me.gameOptions.comLevel[1] + ')';
		} else {
			me.setData.statsData[1].name = me.gameOptions.playerName[1];
			if (me.setData.statsData[1].name === '') {
				me.setData.statsData[1].name = 'Player 2';
			}
		}
		me.saveSetData();
	};

	me.saveSetData = function () {
		localStorage.setItem(me.optionPrefix + 'setData', JSON.stringify(me.setData));
	};
	me.restoreSetData = function () {
		var str = localStorage.getItem(me.optionPrefix + 'setData');
		if (str !== null) {
			me.setData = JSON.parse(str);
		} else {
			me.restoreGameOptions();
			me.initSet();
		}
	};

	return me;
})();
