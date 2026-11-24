import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/config/env.dart';
import '../../../core/theme/brand.dart';
import '../application/session_controller.dart';

const _registrationUrl = 'https://dotinout.com';

/// Employee sign-in, laid out as the web's mobile employee sign-in: gradient background, brand, a white card with
/// username and password, and the links below. There is no forgot-password link, because employees ask their
/// company admin to reset it.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _identifier = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _identifier.dispose();
    _password.dispose();
    super.dispose();
  }

  bool get _canSubmit => !_busy && _identifier.text.trim().isNotEmpty && _password.text.isNotEmpty;

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final error = await ref
        .read(sessionProvider.notifier)
        .signIn(identifier: _identifier.text, password: _password.text);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = error;
    });
  }

  /// Opens a link in the device's browser, never inside the app.
  Future<void> _open(String url) async {
    try {
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    } catch (_) {
      // Nothing to do if no browser can open the link.
    }
  }

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Scaffold(
      body: DecoratedBox(
        decoration: const BoxDecoration(gradient: dotLoginGradient),
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) {
              return SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: constraints.maxHeight - 48),
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 384),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const BrandLockup(size: 56, light: true),
                          const SizedBox(height: 12),
                          const Text(
                            'Employee sign in',
                            style: TextStyle(color: DotColors.indigo100, fontSize: 14),
                          ),
                          const SizedBox(height: 32),
                          Card(
                            child: Padding(
                              padding: const EdgeInsets.all(20),
                              child: Form(
                                key: _formKey,
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.stretch,
                                  children: [
                                    TextFormField(
                                      controller: _identifier,
                                      enabled: !_busy,
                                      keyboardType: TextInputType.emailAddress,
                                      autocorrect: false,
                                      textInputAction: TextInputAction.next,
                                      autofillHints: const [AutofillHints.username],
                                      onChanged: (_) => setState(() {}),
                                      decoration: const InputDecoration(labelText: 'Username'),
                                      validator: (v) =>
                                          (v == null || v.trim().isEmpty) ? 'Enter your email ID or username' : null,
                                    ),
                                    const SizedBox(height: 16),
                                    TextFormField(
                                      controller: _password,
                                      enabled: !_busy,
                                      obscureText: true,
                                      textInputAction: TextInputAction.done,
                                      autofillHints: const [AutofillHints.password],
                                      onChanged: (_) => setState(() {}),
                                      onFieldSubmitted: (_) {
                                        if (_canSubmit) _submit();
                                      },
                                      decoration: const InputDecoration(labelText: 'Password'),
                                      validator: (v) => (v == null || v.isEmpty) ? 'Enter your password' : null,
                                    ),
                                    if (_error != null) ...[
                                      const SizedBox(height: 16),
                                      Semantics(
                                        liveRegion: true,
                                        child: Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                          decoration: BoxDecoration(
                                            color: DotColors.rose50,
                                            borderRadius: BorderRadius.circular(8),
                                          ),
                                          child: Text(
                                            _error!,
                                            style: const TextStyle(
                                              color: DotColors.rose700,
                                              fontSize: 14,
                                              fontWeight: FontWeight.w500,
                                            ),
                                          ),
                                        ),
                                      ),
                                    ],
                                    const SizedBox(height: 20),
                                    FilledButton(
                                      onPressed: _canSubmit ? _submit : null,
                                      child: _busy
                                          ? const SizedBox(
                                              height: 20,
                                              width: 20,
                                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                            )
                                          : const Text('Sign in'),
                                    ),
                                    const SizedBox(height: 16),
                                    Text(
                                      'Forgot your password? Contact your company admin to reset it.',
                                      textAlign: TextAlign.center,
                                      style: textTheme.bodyMedium?.copyWith(color: DotColors.slate600),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 32),
                          TextButton(
                            onPressed: () => _open(_registrationUrl),
                            style: TextButton.styleFrom(foregroundColor: DotColors.indigo100),
                            child: const Text(
                              'New company? Register your business',
                              style: TextStyle(decoration: TextDecoration.underline),
                            ),
                          ),
                          TextButton(
                            onPressed: () => _open('${Env.origin}/privacy'),
                            style: TextButton.styleFrom(foregroundColor: DotColors.indigo200),
                            child: const Text(
                              'Privacy Policy',
                              style: TextStyle(fontSize: 12, decoration: TextDecoration.underline),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
