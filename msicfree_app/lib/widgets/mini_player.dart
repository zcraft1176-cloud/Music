import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:provider/provider.dart';
import '../core/theme.dart';
import '../providers/audio_provider.dart';
import '../screens/now_playing_screen.dart';

class MiniPlayer extends StatelessWidget {
  const MiniPlayer({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<AudioProvider>(
      builder: (context, audio, _) {
        final track = audio.currentTrack;
        if (track == null) return const SizedBox.shrink();

        return GestureDetector(
          onTap: () {
            Navigator.of(context).push(
              PageRouteBuilder(
                pageBuilder: (_, animation, __) => const NowPlayingScreen(),
                transitionsBuilder: (_, animation, __, child) {
                  return SlideTransition(
                    position: Tween<Offset>(
                      begin: const Offset(0, 1),
                      end: Offset.zero,
                    ).animate(CurvedAnimation(
                      parent: animation,
                      curve: Curves.easeOutCubic,
                    )),
                    child: child,
                  );
                },
                transitionDuration: const Duration(milliseconds: 350),
              ),
            );
          },
          child: Container(
            height: 64,
            margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: AppTheme.darkCard,
              borderRadius: BorderRadius.circular(12),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.3),
                  blurRadius: 10,
                  offset: const Offset(0, -2),
                ),
              ],
            ),
            child: Column(
              children: [
                // Progress bar
                ClipRRect(
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
                  child: LinearProgressIndicator(
                    value: audio.progress,
                    minHeight: 2,
                    backgroundColor: Colors.transparent,
                    valueColor: AlwaysStoppedAnimation(
                      AppTheme.primary,
                    ),
                  ),
                ),
                // Content
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Row(
                      children: [
                        // Cover art
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: track.coverUrl != null
                              ? CachedNetworkImage(
                                  imageUrl: track.coverUrl!,
                                  width: 44,
                                  height: 44,
                                  fit: BoxFit.cover,
                                  placeholder: (_, __) => Container(
                                    width: 44,
                                    height: 44,
                                    color: AppTheme.darkBorder,
                                    child: const Icon(
                                      Icons.music_note,
                                      color: AppTheme.textMuted,
                                      size: 20,
                                    ),
                                  ),
                                  errorWidget: (_, __, ___) => Container(
                                    width: 44,
                                    height: 44,
                                    color: AppTheme.darkBorder,
                                    child: const Icon(
                                      Icons.music_note,
                                      color: AppTheme.textMuted,
                                      size: 20,
                                    ),
                                  ),
                                )
                              : Container(
                                  width: 44,
                                  height: 44,
                                  color: AppTheme.darkBorder,
                                  child: const Icon(
                                    Icons.music_note,
                                    color: AppTheme.textMuted,
                                    size: 20,
                                  ),
                                ),
                        ),
                        const SizedBox(width: 12),

                        // Title & Artist
                        Expanded(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                track.title,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 14,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              Text(
                                track.artist,
                                style: const TextStyle(
                                  color: AppTheme.textSecondary,
                                  fontSize: 12,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),

                        // Controls
                        if (audio.isLoading)
                          const SizedBox(
                            width: 24,
                            height: 24,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: AppTheme.primary,
                            ),
                          )
                        else
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              IconButton(
                                icon: Icon(
                                  audio.isPlaying
                                      ? Icons.pause_rounded
                                      : Icons.play_arrow_rounded,
                                  size: 32,
                                ),
                                onPressed: audio.togglePlayPause,
                                padding: EdgeInsets.zero,
                                constraints: const BoxConstraints(
                                  minWidth: 40,
                                  minHeight: 40,
                                ),
                              ),
                              IconButton(
                                icon: const Icon(
                                  Icons.skip_next_rounded,
                                  size: 28,
                                ),
                                onPressed: audio.next,
                                padding: EdgeInsets.zero,
                                constraints: const BoxConstraints(
                                  minWidth: 36,
                                  minHeight: 36,
                                ),
                              ),
                            ],
                          ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
