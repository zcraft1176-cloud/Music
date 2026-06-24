import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:provider/provider.dart';
import '../core/theme.dart';
import '../models/track.dart';
import '../providers/audio_provider.dart';
import '../services/deezer_service.dart';
import '../widgets/track_tile.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final DeezerService _deezer = DeezerService();
  List<Track> _trending = [];
  List<Map<String, dynamic>> _genres = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadContent();
  }

  Future<void> _loadContent() async {
    setState(() => _isLoading = true);

    final results = await Future.wait([
      _deezer.getTrending(limit: 20),
      _deezer.getGenres(),
    ]);

    if (mounted) {
      setState(() {
        _trending = results[0] as List<Track>;
        _genres = results[1] as List<Map<String, dynamic>>;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: RefreshIndicator(
        onRefresh: _loadContent,
        color: AppTheme.primary,
        child: CustomScrollView(
          slivers: [
            // App bar
            SliverAppBar(
              floating: true,
              backgroundColor: AppTheme.darkBg,
              title: Row(
                children: [
                  Image.asset('assets/logo.png', width: 32, height: 32),
                  const SizedBox(width: 10),
                  ShaderMask(
                    shaderCallback: (bounds) => const LinearGradient(
                      colors: [AppTheme.primary, AppTheme.secondary],
                    ).createShader(bounds),
                    child: const Text(
                      'MsicFree',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // Trending section
            SliverToBoxAdapter(
              child: _buildSectionHeader('Trending Now 🔥'),
            ),

            if (_isLoading)
              SliverToBoxAdapter(
                child: SizedBox(
                  height: 200,
                  child: ListView.builder(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    itemCount: 4,
                    itemBuilder: (_, __) => _buildShimmerCard(),
                  ),
                ),
              )
            else
              SliverToBoxAdapter(
                child: SizedBox(
                  height: 200,
                  child: ListView.builder(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    itemCount: _trending.length,
                    itemBuilder: (context, index) {
                      return _buildTrendingCard(_trending[index], index);
                    },
                  ),
                ),
              ),

            // Recently Played
            SliverToBoxAdapter(
              child: _buildSectionHeader('Recently Played'),
            ),
            Consumer<AudioProvider>(
              builder: (context, audio, _) {
                if (audio.history.isEmpty) {
                  return SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Center(
                        child: Column(
                          children: [
                            Icon(Icons.history, size: 48, color: AppTheme.textMuted),
                            const SizedBox(height: 8),
                            Text(
                              'No listening history yet',
                              style: TextStyle(color: AppTheme.textMuted),
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                }
                return SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, index) {
                      if (index >= audio.history.length) return null;
                      return TrackTile(
                        track: audio.history[index],
                        onTap: () {
                          final audio = context.read<AudioProvider>();
                          audio.setQueue(audio.history, index);
                        },
                      );
                    },
                    childCount: audio.history.take(5).length,
                  ),
                );
              },
            ),

            // Browse by Genre
            SliverToBoxAdapter(
              child: _buildSectionHeader('Browse by Genre'),
            ),
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              sliver: SliverGrid(
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 2,
                  childAspectRatio: 2.5,
                  crossAxisSpacing: 10,
                  mainAxisSpacing: 10,
                ),
                delegate: SliverChildBuilderDelegate(
                  (context, index) {
                    if (index >= _genres.length) return null;
                    return _buildGenreCard(_genres[index]);
                  },
                  childCount: _genres.length,
                ),
              ),
            ),

            // Bottom spacing for mini player
            const SliverToBoxAdapter(
              child: SizedBox(height: 100),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 12),
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  Widget _buildTrendingCard(Track track, int index) {
    return GestureDetector(
      onTap: () {
        context.read<AudioProvider>().setQueue(_trending, index);
      },
      child: Container(
        width: 150,
        margin: const EdgeInsets.only(right: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: track.coverUrl != null
                  ? CachedNetworkImage(
                      imageUrl: track.coverUrl!,
                      width: 150,
                      height: 150,
                      fit: BoxFit.cover,
                      placeholder: (_, __) => Container(
                        width: 150,
                        height: 150,
                        color: AppTheme.darkCard,
                        child: const Icon(Icons.music_note, color: AppTheme.textMuted),
                      ),
                      errorWidget: (_, __, ___) => Container(
                        width: 150,
                        height: 150,
                        color: AppTheme.darkCard,
                        child: const Icon(Icons.music_note, color: AppTheme.textMuted),
                      ),
                    )
                  : Container(
                      width: 150,
                      height: 150,
                      color: AppTheme.darkCard,
                      child: const Icon(Icons.music_note, color: AppTheme.textMuted),
                    ),
            ),
            const SizedBox(height: 8),
            Text(
              track.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
            Text(
              track.artist,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildGenreCard(Map<String, dynamic> genre) {
    final colors = [
      const Color(0xFF8B5CF6),
      const Color(0xFFEF4444),
      const Color(0xFF3B82F6),
      const Color(0xFF10B981),
      const Color(0xFFF59E0B),
      const Color(0xFFEC4899),
      const Color(0xFF6366F1),
      const Color(0xFF14B8A6),
    ];
    final color = colors[genre['id'].hashCode % colors.length];

    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [color, color.withValues(alpha: 0.6)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(8),
      ),
      padding: const EdgeInsets.all(12),
      child: Align(
        alignment: Alignment.bottomLeft,
        child: Text(
          genre['name'] ?? '',
          style: const TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: 14,
          ),
        ),
      ),
    );
  }

  Widget _buildShimmerCard() {
    return Container(
      width: 150,
      margin: const EdgeInsets.only(right: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 150,
            height: 150,
            decoration: BoxDecoration(
              color: AppTheme.darkCard,
              borderRadius: BorderRadius.circular(12),
            ),
          ),
          const SizedBox(height: 8),
          Container(width: 100, height: 12, color: AppTheme.darkCard),
          const SizedBox(height: 4),
          Container(width: 70, height: 10, color: AppTheme.darkCard),
        ],
      ),
    );
  }
}
