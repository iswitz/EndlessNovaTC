#!/usr/bin/env perl
use strict;
use warnings;
use FindBin qw($Bin);
use File::Find qw(find);
use File::Spec;
use File::Basename qw(basename);
use JSON::PP qw(encode_json);
use MIME::Base64 qw(encode_base64);
use lib "$Bin/../vendor/evnova-utils/Scripts/lib";
use ResourceFork;

my $default_evn_root = -d '/mnt/c/Users/Isaac/EV Nova' ? '/mnt/c/Users/Isaac/EV Nova' : 'C:/Users/Isaac/EV Nova';
my $evn_root = $ENV{EVN_ROOT} // $default_evn_root;
my $output_root = $ENV{EVN_OUTPUT} // File::Spec->catdir($Bin, '..', 'parsed-data');
my $nova_files = File::Spec->catdir($evn_root, 'Nova Files');
my @paths;
find({
    wanted => sub {
        return unless -f $_;
        push @paths, $File::Find::name if basename($File::Find::name) =~ /\.rez$/i;
    },
    no_chdir => 1,
}, $nova_files);

die "No Nova Data files found under $nova_files\n" unless @paths;
mkdir $output_root unless -d $output_root;

my @resources;
for my $path (sort @paths) {
    my $file = ResourceFork->new($path);
    for my $type ($file->types) {
        for my $resource ($file->resources($type)) {
            push @resources, {
                type => $type,
                id => 0 + $resource->{id},
                name => $resource->{name},
                source => File::Spec->abs2rel($path, $evn_root),
                dataBase64 => encode_base64($resource->read, ''),
            };
        }
    }
}

my %counts;
$counts{$_->{type}}++ for @resources;
my $output = File::Spec->catfile($output_root, 'burger-resources.json');
open my $fh, '>:raw', $output or die "Cannot write $output: $!\n";
print {$fh} JSON::PP->new->utf8->canonical->pretty->encode({
    source => $evn_root,
    format => 'BurgerLib BRGR / EV Nova Windows .rez',
    counts => \%counts,
    resources => \@resources,
});
close $fh or die "Cannot close $output: $!\n";
print "Wrote $output (" . scalar(@resources) . " resources)\n";
