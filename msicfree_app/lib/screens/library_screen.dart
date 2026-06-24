import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/theme.dart';
import '../providers/audio_provider.dart';
import '../widgets/track_tile.dart';

class LibraryScreen extends StatelessWidget {
  const LibraryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: SafeArea(
        child: Column(
          children: [
            // Header
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: Row(
                children: [
                  const Text(
                    'Your Library',
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    icon: const Icon(Icons.settings_outlined),
                    onPressed: () {
                      // TODO: Settings
                    },
                  ),
                ],
              ),
            ),

            // Tabs
            TabBar(
              indicatorColor: AppTheme.primary,
              labelColor: AppTheme.primary,
              unselectedLabelColor: AppTheme.textMuted,
              tabs: const [
                Tab(text: 'History'),
                Tab(text: 'Queue'),
              ],
            ),

            // Tab content
            Expanded(
              child: TabBarView(
                children: [
                  _buildHistoryTab(context),
                  _buildQueueTab(context),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHistoryTab(BuildContext context) {
    return Consumer<AudioProvider>(
      builder: (context, audio, _) {
        if (audio.history.isEmpty) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.history, size: 64, color: AppTheme.textMuted),
                const SizedBox(height: 16),
                const Text(
                  'No listening history',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 8),
                Text(
                  'Play some music to see your history here',
                  style: TextStyle(color: AppTheme.textSecondary),
                ),
              ],
            ),
          );
        }

        return Column(
          children: [
            // Clear history button
            Padding(
              padding: const EdgeInsets.all(8),
              child: Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () {
                    audio.clearHistory();
                  },
                  icon: const Icon(Icons.delete_outline, size: 18, color: Colors.redAccent),
                  label: const Text(
                    'Clear History',
                    style: TextStyle(color: Colors.redAccent),
                  ),
                ),
              ),
            ),
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.only(bottom: 100),
                itemCount: audio.history.length,
                itemBuilder: (context, index) {
                  return TrackTile(
                    track: audio.history[index],
                    onTap: () {
                      audio.setQueue(audio.history, index);
                    },
                  );
                },
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildQueueTab(BuildContext context) {
    return Consumer<AudioProvider>(
      builder: (context, audio, _) {
        if (audio.queue.isEmpty) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.queue_music, size: 64, color: AppTheme.textMuted),
                const SizedBox(height: 16),
                const Text(
                  'Queue is empty',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 8),
                Text(
                  'Add tracks to your queue',
                  style: TextStyle(color: AppTheme.textSecondary),
                ),
              ],
            ),
          );
        }

        return ListView.builder(
          padding: const EdgeInsets.only(bottom: 100),
          itemCount: audio.queue.length,
          itemBuilder: (context, index) {
            final isCurrentTrack = index == audio.currentIndex;
            return TrackTile(
              track: audio.queue[index],
              isActive: isCurrentTrack,
              onTap: () {
                audio.setQueue(audio.queue, index);
              },
            );
          },
        );
      },
    );
  }
}
