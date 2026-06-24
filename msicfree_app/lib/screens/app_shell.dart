import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/audio_provider.dart';
import '../widgets/mini_player.dart';
import 'home_screen.dart';
import 'search_screen.dart';
import 'library_screen.dart';

class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _currentIndex = 0;

  final List<Widget> _screens = const [
    HomeScreen(),
    SearchScreen(),
    LibraryScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          // Main content area
          Positioned.fill(
            child: IndexedStack(
              index: _currentIndex,
              children: _screens,
            ),
          ),

          // Mini Player (shown when a track is playing)
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Consumer<AudioProvider>(
              builder: (context, audio, _) {
                if (audio.currentTrack == null) return const SizedBox.shrink();
                return const MiniPlayer();
              },
            ),
          ),
        ],
      ),
      bottomNavigationBar: Consumer<AudioProvider>(
        builder: (context, audio, child) {
          return Padding(
            // Add padding when mini player is visible
            padding: EdgeInsets.only(
              top: audio.currentTrack != null ? 64 : 0,
            ),
            child: child,
          );
        },
        child: NavigationBar(
          selectedIndex: _currentIndex,
          onDestinationSelected: (index) {
            setState(() => _currentIndex = index);
          },
          backgroundColor: Theme.of(context).colorScheme.surface,
          indicatorColor: Theme.of(context).colorScheme.primary.withValues(alpha: 0.2),
          destinations: const [
            NavigationDestination(
              icon: Icon(Icons.home_outlined),
              selectedIcon: Icon(Icons.home),
              label: 'Home',
            ),
            NavigationDestination(
              icon: Icon(Icons.search),
              selectedIcon: Icon(Icons.search),
              label: 'Search',
            ),
            NavigationDestination(
              icon: Icon(Icons.library_music_outlined),
              selectedIcon: Icon(Icons.library_music),
              label: 'Library',
            ),
          ],
        ),
      ),
    );
  }
}
