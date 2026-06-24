import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/theme.dart';
import '../models/track.dart';
import '../providers/audio_provider.dart';
import '../services/deezer_service.dart';
import '../widgets/track_tile.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final DeezerService _deezer = DeezerService();
  final TextEditingController _searchController = TextEditingController();
  final FocusNode _focusNode = FocusNode();
  List<Track> _results = [];
  bool _isSearching = false;
  bool _hasSearched = false;

  Future<void> _search(String query) async {
    if (query.trim().isEmpty) return;

    setState(() {
      _isSearching = true;
      _hasSearched = true;
    });

    final results = await _deezer.searchTracks(query, limit: 30);

    if (mounted) {
      setState(() {
        _results = results;
        _isSearching = false;
      });
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(
        children: [
          // Search bar
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: _searchController,
              focusNode: _focusNode,
              onSubmitted: _search,
              textInputAction: TextInputAction.search,
              style: const TextStyle(fontSize: 16),
              decoration: InputDecoration(
                hintText: 'Search songs, artists, genres...',
                prefixIcon: const Icon(Icons.search, color: AppTheme.textMuted),
                suffixIcon: _searchController.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear, color: AppTheme.textMuted),
                        onPressed: () {
                          _searchController.clear();
                          setState(() {
                            _results.clear();
                            _hasSearched = false;
                          });
                          _focusNode.requestFocus();
                        },
                      )
                    : null,
                filled: true,
                fillColor: AppTheme.darkCard,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: BorderSide.none,
                ),
              ),
              onChanged: (_) => setState(() {}),
            ),
          ),

          // Results
          Expanded(
            child: _isSearching
                ? const Center(
                    child: CircularProgressIndicator(color: AppTheme.primary),
                  )
                : !_hasSearched
                    ? _buildEmptyState()
                    : _results.isEmpty
                        ? _buildNoResults()
                        : ListView.builder(
                            padding: const EdgeInsets.only(bottom: 100),
                            itemCount: _results.length,
                            itemBuilder: (context, index) {
                              return TrackTile(
                                track: _results[index],
                                onTap: () {
                                  final audio = context.read<AudioProvider>();
                                  audio.setQueue(_results, index);

                                  // Listen for errors
                                  void errorListener() {
                                    if (audio.errorMessage != null && mounted) {
                                      ScaffoldMessenger.of(context).showSnackBar(
                                        SnackBar(
                                          content: Text(audio.errorMessage!),
                                          backgroundColor: Colors.redAccent,
                                          duration: const Duration(seconds: 3),
                                        ),
                                      );
                                      audio.removeListener(errorListener);
                                    }
                                  }
                                  audio.addListener(errorListener);

                                  // Auto-remove listener after 15 seconds
                                  Future.delayed(const Duration(seconds: 15), () {
                                    audio.removeListener(errorListener);
                                  });
                                },
                              );
                            },
                          ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.search, size: 64, color: AppTheme.textMuted),
          const SizedBox(height: 16),
          const Text(
            'Find your favorite music',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Search by title, artist, or genre',
            style: TextStyle(color: AppTheme.textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _buildNoResults() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.music_off, size: 64, color: AppTheme.textMuted),
          const SizedBox(height: 16),
          const Text(
            'No results found',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Text(
            'Try different keywords',
            style: TextStyle(color: AppTheme.textSecondary),
          ),
        ],
      ),
    );
  }
}
