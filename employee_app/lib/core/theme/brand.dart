import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Dotinout colours. They match the web app's Tailwind classes (indigo, violet and slate).
class DotColors {
  DotColors._();

  static const indigo50 = Color(0xFFEEF2FF);
  static const indigo100 = Color(0xFFE0E7FF);
  static const indigo200 = Color(0xFFC7D2FE);
  static const indigo600 = Color(0xFF4F46E5);
  static const indigo700 = Color(0xFF4338CA);
  static const indigo800 = Color(0xFF3730A3);
  static const violet200 = Color(0xFFDDD6FE);
  static const violet600 = Color(0xFF7C3AED);
  static const slate100 = Color(0xFFF1F5F9);
  static const slate200 = Color(0xFFE2E8F0);
  static const slate300 = Color(0xFFCBD5E1);
  static const slate400 = Color(0xFF94A3B8);
  static const slate500 = Color(0xFF64748B);
  static const slate600 = Color(0xFF475569);
  static const slate900 = Color(0xFF0F172A);
  static const rose50 = Color(0xFFFFF1F2);
  static const rose600 = Color(0xFFE11D48);
  static const rose700 = Color(0xFFBE123C);
}

/// The login and splash background: indigo-700, indigo-600 and indigo-800 from top to bottom, as on the web.
const dotLoginGradient = LinearGradient(
  begin: Alignment.topCenter,
  end: Alignment.bottomCenter,
  colors: [DotColors.indigo700, DotColors.indigo600, DotColors.indigo800],
);

/// The Dotinout mark: a ring with a gap at the top, where the punch dot sits, and a centre dot. It is drawn on a
/// 48-unit grid, the same as BrandMark in the web app, so the two look identical.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 36});

  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox.square(dimension: size, child: CustomPaint(painter: _BrandMarkPainter()));
  }
}

class _BrandMarkPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 48;
    final tile = Rect.fromLTWH(0, 0, size.width, size.height);
    canvas.drawRRect(
      RRect.fromRectAndRadius(tile, Radius.circular(11 * s)),
      Paint()
        ..shader = const LinearGradient(colors: [DotColors.indigo600, DotColors.violet600]).createShader(tile),
    );
    // Same transform as the web mark: translate(5.28 5.28) scale(0.78) on the 48-unit grid.
    canvas.save();
    canvas.translate(5.28 * s, 5.28 * s);
    canvas.scale(0.78 * s);
    final ring = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.4;
    canvas.drawArc(
      Rect.fromCircle(center: const Offset(24, 24), radius: 12),
      -math.pi / 3,
      5 * math.pi / 3,
      false,
      ring,
    );
    final dot = Paint()..color = Colors.white;
    canvas.drawCircle(const Offset(24, 24), 4.6, dot);
    canvas.drawCircle(const Offset(24, 12), 2.6, dot);
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// The mark plus the "Dotinout" wordmark. "in" and "out" are coloured to carry the punch idea, as on the web.
class BrandLockup extends StatelessWidget {
  const BrandLockup({super.key, this.size = 36, this.light = false});

  final double size;

  /// True on dark or gradient backgrounds (login, splash).
  final bool light;

  @override
  Widget build(BuildContext context) {
    final base = TextStyle(
      fontSize: size * 0.5,
      fontWeight: FontWeight.w800,
      letterSpacing: -0.5,
      height: 1,
      color: light ? Colors.white : DotColors.slate900,
    );
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        BrandMark(size: size),
        SizedBox(width: size * 0.3),
        Text.rich(
          TextSpan(
            style: base,
            children: [
              const TextSpan(text: 'Dot'),
              TextSpan(
                text: 'in',
                style: TextStyle(color: light ? DotColors.indigo200 : DotColors.indigo600),
              ),
              TextSpan(
                text: 'out',
                style: TextStyle(color: light ? DotColors.violet200 : DotColors.violet600),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
