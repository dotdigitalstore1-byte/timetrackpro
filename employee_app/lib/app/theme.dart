import 'package:flutter/material.dart';

import '../core/theme/brand.dart';

/// The app theme. Cards, buttons, fields, the header and the bottom bar use the web app's styles.
ThemeData buildDotTheme() {
  const scheme = ColorScheme.light(
    primary: DotColors.indigo600,
    onPrimary: Colors.white,
    secondary: DotColors.violet600,
    onSecondary: Colors.white,
    surface: Colors.white,
    onSurface: DotColors.slate900,
    onSurfaceVariant: DotColors.slate500,
    outline: DotColors.slate300,
    outlineVariant: DotColors.slate200,
    error: DotColors.rose600,
    onError: Colors.white,
    surfaceContainerHighest: DotColors.slate200,
  );
  final fieldBorder = OutlineInputBorder(
    borderRadius: BorderRadius.circular(12),
    borderSide: const BorderSide(color: DotColors.slate300),
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: DotColors.slate100,
    dividerColor: DotColors.slate200,
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white,
      foregroundColor: DotColors.slate900,
      elevation: 0,
      scrolledUnderElevation: 0,
      surfaceTintColor: Colors.transparent,
      centerTitle: false,
      titleTextStyle: TextStyle(color: DotColors.slate900, fontSize: 16, fontWeight: FontWeight.w700),
      shape: Border(bottom: BorderSide(color: DotColors.slate200)),
    ),
    cardTheme: const CardThemeData(
      color: Colors.white,
      elevation: 0,
      surfaceTintColor: Colors.transparent,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(16)),
        side: BorderSide(color: DotColors.slate200),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: DotColors.indigo600,
        foregroundColor: Colors.white,
        disabledBackgroundColor: const Color(0xFFA5B4FC),
        disabledForegroundColor: Colors.white,
        elevation: 0,
        minimumSize: const Size.fromHeight(44),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      labelStyle: const TextStyle(color: DotColors.slate600, fontSize: 13, fontWeight: FontWeight.w600),
      border: fieldBorder,
      enabledBorder: fieldBorder,
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: DotColors.indigo600, width: 2),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      indicatorColor: DotColors.indigo50,
      height: 64,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: states.contains(WidgetState.selected) ? DotColors.indigo600 : DotColors.slate400,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(
          color: states.contains(WidgetState.selected) ? DotColors.indigo600 : DotColors.slate400,
        ),
      ),
    ),
  );
}
