import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:provider/provider.dart';
import '../core/theme.dart';
import '../providers/audio_provider.dart';

class NowPlayingScreen extends StatelessWidget {
  const NowPlayingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<AudioProvider>(
      builder: (context, audio, _) {
        final track = audio.currentTrack;
        if (track == null) {
          return const Scaffold(
            body: Center(child: Text('No track playing')),
          );
        }

        return Scaffold(
          backgroundColor: AppTheme.darkBg,
          body: SafeArea(
            child: Column(
              children: [
                // Top bar
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  child: Row(
                    children: [
                      IconButton(
                        icon: const Icon(Icons.keyboard_arrow_down, size: 32),
                        onPressed: () => Navigator.of(context).pop(),
                      ),
                      const Expanded(
                        child: Text(
                          'Now Playing',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            fontSize: 14,
                            color: AppTheme.textSecondary,
                          ),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.more_vert),
                        onPressed: () {
                          // TODO: More options
                        },
                      ),
                    ],
                  ),
                ),

                const Spacer(),

                // Cover Art
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 40),
                  child: AspectRatio(
                    aspectRatio: 1,
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: [
                          BoxShadow(
                            color: AppTheme.primary.withValues(alpha: 0.3),
                            blurRadius: 40,
                            offset: const Offset(0, 20),
                          ),
                        ],
                      ),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(16),
                        child: track.coverUrl != null
                            ? CachedNetworkImage(
                                imageUrl: track.coverUrl!,
                                fit: BoxFit.cover,
                                placeholder: (_, __) => Container(
                                  color: AppTheme.darkCard,
                                  child: const Icon(
                                    Icons.music_note,
                                    size: 80,
                                    color: AppTheme.textMuted,
                                  ),
                                ),
                                errorWidget: (_, __, ___) => Container(
                                  color: AppTheme.darkCard,
                                  child: const Icon(
                                    Icons.music_note,
                                    size: 80,
                                    color: AppTheme.textMuted,
                                  ),
                                ),
                              )
                            : Container(
                                color: AppTheme.darkCard,
                                child: const Icon(
                                  Icons.music_note,
                                  size: 80,
                                  color: AppTheme.textMuted,
                                ),
                              ),
                      ),
                    ),
                  ),
                ),

                const Spacer(),

                // Track info
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 32),
                  child: Column(
                    children: [
                      Text(
                        track.title,
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 6),
                      Text(
                        track.artist,
                        style: const TextStyle(
                          fontSize: 16,
                          color: AppTheme.textSecondary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 28),

                // Seek bar
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Column(
                    children: [
                      SliderTheme(
                        data: SliderThemeData(
                          activeTrackColor: AppTheme.primary,
                          inactiveTrackColor: AppTheme.darkBorder,
                          thumbColor: AppTheme.primary,
                          thumbShape: const RoundSliderThumbShape(
                            enabledThumbRadius: 6,
                          ),
                          overlayShape: const RoundSliderOverlayShape(
                            overlayRadius: 16,
                          ),
                          trackHeight: 4,
                        ),
                        child: Slider(
                          value: audio.progress.clamp(0.0, 1.0),
                          onChanged: (value) {
                            final newPosition = Duration(
                              milliseconds:
                                  (value * audio.duration.inMilliseconds)
                                      .round(),
                            );
                            audio.seekTo(newPosition);
                          },
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              _formatDuration(audio.position),
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppTheme.textMuted,
                              ),
                            ),
                            Text(
                              _formatDuration(audio.duration),
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppTheme.textMuted,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 16),

                // Controls
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      // Shuffle
                      IconButton(
                        icon: Icon(
                          Icons.shuffle,
                          color: audio.shuffle
                              ? AppTheme.primary
                              : AppTheme.textMuted,
                        ),
                        onPressed: audio.toggleShuffle,
                      ),

                      // Previous
                      IconButton(
                        icon: const Icon(Icons.skip_previous_rounded, size: 36),
                        onPressed: audio.previous,
                      ),

                      // Play/Pause
                      Container(
                        width: 64,
                        height: 64,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          gradient: const LinearGradient(
                            colors: [AppTheme.primary, AppTheme.secondary],
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: AppTheme.primary.withValues(alpha: 0.4),
                              blurRadius: 16,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: audio.isLoading
                            ? const Center(
                                child: SizedBox(
                                  width: 28,
                                  height: 28,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2.5,
                                    color: Colors.white,
                                  ),
                                ),
                              )
                            : IconButton(
                                icon: Icon(
                                  audio.isPlaying
                                      ? Icons.pause_rounded
                                      : Icons.play_arrow_rounded,
                                  size: 36,
                                  color: Colors.white,
                                ),
                                onPressed: audio.togglePlayPause,
                              ),
                      ),

                      // Next
                      IconButton(
                        icon: const Icon(Icons.skip_next_rounded, size: 36),
                        onPressed: audio.next,
                      ),

                      // Repeat
                      IconButton(
                        icon: Icon(
                          audio.repeatMode == TrackRepeatMode.one
                              ? Icons.repeat_one
                              : Icons.repeat,
                          color: audio.repeatMode != TrackRepeatMode.off
                              ? AppTheme.primary
                              : AppTheme.textMuted,
                        ),
                        onPressed: audio.toggleRepeat,
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 40),
              ],
            ),
          ),
        );
      },
    );
  }

  String _formatDuration(Duration duration) {
    final minutes = duration.inMinutes;
    final seconds = duration.inSeconds % 60;
    return '$minutes:${seconds.toString().padLeft(2, '0')}';
  }
}
