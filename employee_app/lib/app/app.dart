import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'router.dart';
import 'theme.dart';

class DotinoutApp extends ConsumerWidget {
  const DotinoutApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'Dotinout',
      debugShowCheckedModeBanner: false,
      theme: buildDotTheme(),
      routerConfig: router,
    );
  }
}
