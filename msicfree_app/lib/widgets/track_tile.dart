import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../core/theme.dart';
import '../models/track.dart';

class TrackTile extends StatelessWidget {
  final Track track;
  final VoidCallback? onTap;
  final bool isActive;
  final Widget? trailing;

  const TrackTile({
    super.key,
    required this.track,
    this.onTap,
    this.isActive = false,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Row(
          children: [
            // Cover art
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: track.coverUrl != null
                  ? CachedNetworkImage(
                      imageUrl: track.coverUrl!,
                      width: 50,
                      height: 50,
                      fit: BoxFit.cover,
                      placeholder: (_, __) => _placeholderBox(),
                      errorWidget: (_, __, ___) => _placeholderBox(),
                    )
                  : _placeholderBox(),
            ),
            const SizedBox(width: 12),

            // Track info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    track.title,
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                      color: isActive ? AppTheme.primary : AppTheme.textPrimary,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${track.artist}${track.durationFormatted != '--:--' ? ' • ${track.durationFormatted}' : ''}',
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppTheme.textSecondary,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),

            // Trailing widget or more button
            if (trailing != null)
              trailing!
            else
              IconButton(
                icon: const Icon(
                  Icons.more_vert,
                  color: AppTheme.textMuted,
                  size: 20,
                ),
                onPressed: () {
                  // TODO: Context menu (add to playlist, add to queue, etc.)
                },
              ),
          ],
        ),
      ),
    );
  }

  Widget _placeholderBox() {
    return Container(
      width: 50,
      height: 50,
      color: AppTheme.darkCard,
      child: const Icon(
        Icons.music_note,
        color: AppTheme.textMuted,
        size: 22,
      ),
    );
  }
}
