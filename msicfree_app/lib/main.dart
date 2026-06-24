import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/theme.dart';
import 'providers/audio_provider.dart';
import 'screens/app_shell.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MsicFreeApp());
}

class MsicFreeApp extends StatelessWidget {
  const MsicFreeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AudioProvider()),
      ],
      child: MaterialApp(
        title: 'MsicFree',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.darkTheme,
        home: const AppShell(),
      ),
    );
  }
}
