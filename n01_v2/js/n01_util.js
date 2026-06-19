/*
 * n01_util.js
 *
 * Copyright (C) 1996-2015 by Ohno Tomoaki. All rights reserved.
 */

/*eslint-env browser, jquery*/
$(document).ready( function() {
	var touchFlag = false;
	$('.button').on('mousedown touchstart', function() {
		$(this).css('background-color', '#ffffff');
		$(this).css('color', $('#header').css('background-color'));
		touchFlag = true;
	});
	$('.button').on('mouseup touchend', function() {
		$(this).css('background-color', $('#header').css('background-color'));
		$(this).css('color', '#ffffff');
		touchFlag = false;
	});
	$('.button').on('mouseout', function() {
		$(this).css('background-color', $('#header').css('background-color'));
		$(this).css('color', '#ffffff');
		touchFlag = false;
	});
	$('.button').on('mousemove', function() {
		if (!touchFlag) {
			$(this).css('background-color', 'rgba(255, 255, 255, 0.2)');
		}
	});
});

var n01_util = (function () {
	var me = {};

	me.headerResize = function () {
		var windowSize = ($(window).width() < $(window).height()) ? $(window).width() : ($(window).height() * 0.8);

		$('#header').css('box-shadow', '0px 0px ' + (windowSize * 0.015) + 'px rgba(0,0,0,0.8)');
		
		var headerFont = windowSize * 0.06;
		$('#header_title').css('font-size', headerFont + 'px');
		var headerDetailFont = windowSize * 0.04;
		$('#header_title_detail').css('font-size', headerDetailFont + 'px');

		var tdButtonWidth = windowSize * 0.23;
		$('.td_button').css('width', tdButtonWidth + 'px');
		var tdButtonPadding = windowSize * 0.02;
		$('.td_button').css('padding', tdButtonPadding + 'px');

		var buttonBorder = windowSize * 0.003;
		if (buttonBorder < 1) {
			buttonBorder = 1;
		}
		$('.button').css('border', buttonBorder + 'px solid #fff');

		var buttonFont = windowSize * 0.05;
		$('.button').css('font-size', buttonFont + 'px');
		var buttonPadding = windowSize * 0.023;
		$('.button').css('padding', buttonPadding + 'px');
		var buttonRadius = windowSize * 0.06;
		$('.button').css('border-radius', buttonRadius + 'px');
		$('.button').css('-webkit-border-radius', buttonRadius + 'px');
		$('.button').css('-moz-border-radius', buttonRadius + 'px');

		var articleMargin = windowSize * 0.03;
		$('#article').css('margin', articleMargin + 'px');

		var headerHeight = $('#header_table').height();
		$('#header_back').css('height', headerHeight + 'px');
		$('#article').css('padding', headerHeight + 'px 0 0 0');
	};

	me.getUserAgent = function () {
		var ua = {};
		ua.name = window.navigator.userAgent.toLowerCase();

		ua.isWindowsPhone = ua.name.indexOf('windows phone') >= 0 || ua.name.indexOf('iemobile') >= 0;
		ua.isiPhone = ua.name.indexOf('iphone') >= 0;
		ua.isiPod = ua.name.indexOf('ipod') >= 0;
		ua.isiPad = ua.name.indexOf('ipad') >= 0;
		ua.isiOS = (ua.isiPhone || ua.isiPod || ua.isiPad);
		ua.isAndroid = ua.name.indexOf('android') >= 0;
		ua.isTablet = (ua.isiPad || (ua.isAndroid && ua.name.indexOf('mobile') < 0));
		return ua;
	};

	return me;
})();
