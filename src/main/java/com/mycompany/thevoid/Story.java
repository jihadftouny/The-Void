/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

/**
 * @author jihad
 */
public class Story {

    public static void printIntro(Player player) {
        GameLogic.clearConsole();
        GameLogic.printHeader("STORY", true);
        System.out.println(
                "The capital of Absolution, 2100 . . .\n"
                        + "- - -\n"
                        + "You are the last hope of your society. The Kingpins of\n"
                        + "The Undercity finally put their convoluted plan into action,\n"
                        + "and the Arch-Mage of house Grandmore has ordered you\n"
                        + player.name + ", to delve into the Rift and kill the kingpins.\n. . .");
        System.out.println("Return with their brainchips so that Grandmore's Memorians can extract all the available information from them.");
        GameLogic.anythingToContinue();
    }

    // First Floor - "Zaun"
    // This is the place where criminals are sent from Absolution. In the final fight, you kill one of the Kingpins, and someone throws you deeper into the rift. The deeper you go into the rift, the faster time passes above you(?), the more difficult it is to come back up(?)
    public static void firstActIntro() {
        GameLogic.clearConsole();
        GameLogic.printHeader("ACT I", true);
        System.out.println("\n\n\n\n");
        GameLogic.anythingToContinue();
    }

    public static void firstActOutro() {
        GameLogic.clearConsole();
        GameLogic.printHeader("ACT I", true);
        System.out.println("\n\n\n\n");
        GameLogic.anythingToContinue();
    }

    // Second Floor - The Upside Down
    public static void secondActIntro() {
        GameLogic.clearConsole();
        GameLogic.printHeader("ACT II", true);
        System.out.println("\n\n\n\n");
        GameLogic.anythingToContinue();
    }

    public static void secondActOutro() {
        GameLogic.clearConsole();
        GameLogic.printHeader("ACT II", true);
        System.out.println("\n\n\n\n");
        GameLogic.anythingToContinue();
    }

    // Third Floor - White City
    public static void thirdActIntro() {
        GameLogic.clearConsole();
        GameLogic.printHeader("ACT III", true);
        System.out.println("\n\n\n\n");
        GameLogic.anythingToContinue();
    }

    public static void thirdActOutro() {
        GameLogic.clearConsole();
        GameLogic.printHeader("ACT III", true);
        System.out.println("\n\n\n\n");
        GameLogic.anythingToContinue();
    }

    // Fourth Floor - The Inner World
    // It's a pretty place, with ancient ruins, vast forests, little amount of civilization in the beggining, then you find the "City of Angels". enemies here are somewhat "divine looking", angels, ancient creatures, mythical creatures, etc. (maybe deactivate the Two-name random generator).

    public static void fourthActIntro() {
        GameLogic.clearConsole();
        GameLogic.printHeader("ACT IV", true);
        System.out.println("\n\n\n\n");
        GameLogic.anythingToContinue();
    }

    public static void fourthActOutro() {
        GameLogic.clearConsole();
        GameLogic.printHeader("ACT IV", true);
        System.out.println("\n\n\n\n");
        GameLogic.anythingToContinue();
    }

    //Final Boss fight - Entrance to the Void
    public static void fifthActIntro() {
        GameLogic.clearConsole();
        GameLogic.printHeader("ACT V", true);
        System.out.println("\n\n\n\n");
        GameLogic.anythingToContinue();
    }

    //if you don't kill the boss, you go to this.
    //here you are thrown into the void, never coming back. infinite loops of battle
    public static void fifthActOutro() {
        GameLogic.clearConsole();
        GameLogic.printHeader("ACT V", true);
        System.out.println("\n\n\n\n");
        GameLogic.anythingToContinue();
    }

    // the end after you kill the boss. you manage to go back to the surface (maybe make the player come back up the floors, with a new skill or mechanics (very later on)
    public static void printEnd(Player player) {
        GameLogic.clearConsole();
        GameLogic.printHeader("END.", true);
        System.out.println("\n\n\n\n" + player.name);
        GameLogic.anythingToContinue();
    }
}
